// Logs where the Mac's energy goes while it runs on battery, so a session can tell which Claude
// Code sessions and prompts cost the most. Every interval it reads each process's CPU energy, CPU
// time and GPU time, groups the processes by the session that ran them, as the pid files that
// hooks/energy-session-pid.sh writes say, or else by the app at the top of their parent chain,
// and appends one JSON line to <log dir>/<date>.jsonl. The LaunchAgent that install.sh writes
// runs it with the log directory as its one argument.
//
// Each line: t (Unix seconds), dt (seconds since the last line), w (battery draw in watts, the
// mean of the gauge's momentary readings at both ends, which it updates about once a minute), b
// (joules the battery gave, from its charge counter, which also moves about once a minute, so only
// sums over minutes are exact), pct (charge in percent), r (joules per CPU second of a busy core,
// measured at start), cs (CPU seconds of every process, root ones included), gt (GPU seconds of
// every process), e (joules the chip's counters measured by part: cpu, gpu, ane, mem for the
// memory and its controllers, disp for the display engine and soc for the rest of the chip) and g,
// a map of group to {j, c, u, uj, g}: joules and CPU seconds of the processes seen running, CPU
// seconds of processes that started and ended between two lines, those seconds priced at r, and
// GPU seconds.
// A group is "session:<id>", an app name, or "other" for the apps under 0.05 joules in that line.
// What the battery gave beyond the chip went to the screen, the SSD, Wi-Fi and the rest of the Mac.

import Darwin
import Foundation
import IOKit

var arguments = Array(CommandLine.arguments.dropFirst())
func option(_ name: String) -> String? {
  guard let i = arguments.firstIndex(of: name), i + 1 < arguments.count else { return nil }
  defer { arguments.removeSubrange(i...(i + 1)) }
  return arguments[i + 1]
}
let interval = Double(option("--interval") ?? "") ?? 10
let samples = Int(option("--samples") ?? "") ?? 0
let always = arguments.contains("--always")
arguments.removeAll { $0 == "--always" }
guard arguments.count == 1 else {
  FileHandle.standardError.write(Data(
    "usage: energy-sampler <log dir> [--interval s] [--samples n] [--always]\n".utf8))
  exit(64)
}
let logDir = arguments[0]
let pidDir = logDir + "/pids"
let keepDays = 30
try? FileManager.default.createDirectory(atPath: pidDir, withIntermediateDirectories: true)

var timebase = mach_timebase_info_data_t()
mach_timebase_info(&timebase)
func seconds(_ ticks: UInt64) -> Double {
  Double(ticks) * Double(timebase.numer) / Double(timebase.denom) / 1e9
}

struct Proc {
  var ppid: Int32
  var start: UInt64
  var energy: UInt64
  var cpu: UInt64
  var child: UInt64
  var gpu: UInt64
}

func pids() -> [Int32] {
  let count = proc_listallpids(nil, 0)
  var buffer = [Int32](repeating: 0, count: Int(count) + 64)
  let got = buffer.withUnsafeMutableBytes {
    proc_listallpids($0.baseAddress, Int32($0.count))
  }
  return Array(buffer.prefix(Int(max(got, 0))))
}

func parent(_ pid: Int32) -> Int32? {
  var info = proc_bsdinfo()
  let size = Int32(MemoryLayout<proc_bsdinfo>.size)
  guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size else { return nil }
  return Int32(info.pbi_ppid)
}

func usage(_ pid: Int32) -> rusage_info_v6? {
  var info = rusage_info_v6()
  let ok = withUnsafeMutablePointer(to: &info) {
    $0.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) {
      proc_pid_rusage(pid, RUSAGE_INFO_V6, $0)
    }
  }
  return ok == 0 ? info : nil
}

var paths: [String: String] = [:]
func path(_ pid: Int32, _ start: UInt64) -> String {
  let key = "\(pid):\(start)"
  if let known = paths[key] { return known }
  var buffer = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
  let length = proc_pidpath(pid, &buffer, UInt32(buffer.count))
  let found = length > 0 ? String(cString: buffer) : ""
  paths[key] = found
  return found
}

func appName(_ path: String) -> String {
  let parts = path.split(separator: "/")
  if let app = parts.first(where: { $0.hasSuffix(".app") }) { return String(app.dropLast(4)) }
  return parts.last.map(String.init) ?? "unknown"
}

// Per-process GPU time in nanoseconds, from the GPU driver's user clients.
func gpuTimes() -> [Int32: UInt64] {
  var times: [Int32: UInt64] = [:]
  var accelerators: io_iterator_t = 0
  guard IOServiceGetMatchingServices(
    kIOMainPortDefault, IOServiceMatching("IOAccelerator"), &accelerators) == KERN_SUCCESS
  else { return times }
  defer { IOObjectRelease(accelerators) }
  var accelerator = IOIteratorNext(accelerators)
  while accelerator != 0 {
    var clients: io_iterator_t = 0
    if IORegistryEntryGetChildIterator(accelerator, kIOServicePlane, &clients) == KERN_SUCCESS {
      var client = IOIteratorNext(clients)
      while client != 0 {
        let creator = IORegistryEntryCreateCFProperty(
          client, "IOUserClientCreator" as CFString, kCFAllocatorDefault, 0)?
          .takeRetainedValue() as? String
        let appUsage = IORegistryEntryCreateCFProperty(
          client, "AppUsage" as CFString, kCFAllocatorDefault, 0)?
          .takeRetainedValue() as? [[String: Any]]
        if let creator, let appUsage,
          let pid = Int32(creator.dropFirst(4).prefix { $0.isNumber })
        {
          for entry in appUsage {
            times[pid, default: 0] += (entry["accumulatedGPUTime"] as? NSNumber)?.uint64Value ?? 0
          }
        }
        IOObjectRelease(client)
        client = IOIteratorNext(clients)
      }
      IOObjectRelease(clients)
    }
    IOObjectRelease(accelerator)
    accelerator = IOIteratorNext(accelerators)
  }
  return times
}

struct Battery {
  let external: Bool
  let watts, volts: Double
  let percent, charge: Int
}

func battery() -> Battery? {
  let service = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("AppleSmartBattery"))
  guard service != 0 else { return nil }
  defer { IOObjectRelease(service) }
  func property(_ key: String) -> Any? {
    IORegistryEntryCreateCFProperty(service, key as CFString, kCFAllocatorDefault, 0)?
      .takeRetainedValue()
  }
  func number(_ key: String) -> NSNumber? { property(key) as? NSNumber }
  let milliamps = Double(number("InstantAmperage")?.int64Value ?? 0)
  let millivolts = Double(number("Voltage")?.int64Value ?? 0)
  let data = property("BatteryData") as? [String: Any]
  return Battery(
    external: number("ExternalConnected")?.boolValue ?? true,
    watts: -milliamps * millivolts / 1e6, volts: millivolts / 1000,
    percent: number("CurrentCapacity")?.intValue ?? 0,
    charge: (data?["AppleRawCurrentCapacity"] as? NSNumber)?.intValue ?? 0)
}

// Busy and total scheduler ticks summed over every core, root processes' time included.
func cpuTicks() -> (busy: UInt64, all: UInt64, cores: Int) {
  var cores: natural_t = 0
  var info: processor_info_array_t?
  var count: mach_msg_type_number_t = 0
  guard host_processor_info(mach_host_self(), PROCESSOR_CPU_LOAD_INFO, &cores, &info, &count)
    == KERN_SUCCESS, let info
  else { return (0, 0, 0) }
  defer {
    vm_deallocate(mach_task_self_, vm_address_t(bitPattern: info),
      vm_size_t(count) * vm_size_t(MemoryLayout<integer_t>.stride))
  }
  var busy: UInt64 = 0, all: UInt64 = 0
  for core in 0..<Int(cores) {
    for state in 0..<Int(CPU_STATE_MAX) {
      let ticks = UInt64(UInt32(bitPattern: info[core * Int(CPU_STATE_MAX) + state]))
      all += ticks
      if state != Int(CPU_STATE_IDLE) { busy += ticks }
    }
  }
  return (busy, all, Int(cores))
}

// The chip's own energy counters, from IOReport's Energy Model group, which needs no root. The
// library is private, so it is opened at run time and the sampler logs no e when it is missing.
typealias CopyChannels = @convention(c) (CFString?, CFString?, UInt64, UInt64, UInt64)
  -> Unmanaged<CFDictionary>?
typealias Subscribe = @convention(c) (UnsafeMutableRawPointer?, CFMutableDictionary,
  UnsafeMutablePointer<Unmanaged<CFMutableDictionary>?>, UInt64, CFTypeRef?) -> OpaquePointer?
typealias Sample = @convention(c) (OpaquePointer, CFMutableDictionary, CFTypeRef?)
  -> Unmanaged<CFDictionary>?
typealias Delta = @convention(c) (CFDictionary, CFDictionary, CFTypeRef?) -> Unmanaged<CFDictionary>?
typealias Value = @convention(c) (CFDictionary, Int32) -> Int64
typealias Label = @convention(c) (CFDictionary) -> Unmanaged<CFString>?

let chipParts = [
  "CPU Energy": "cpu", "GPU": "gpu", "ANE": "ane", "DRAM": "mem", "AMCC": "mem", "DCS": "mem",
  "DISP": "disp", "DISPEXT": "disp", "ECPM": "soc", "PCPM": "soc", "ISP": "soc", "AVE": "soc",
  "MSR": "soc", "VDEC": "soc", "SOC_AON": "soc",
]
let joulesPerUnit = ["mJ": 1e-3, "uJ": 1e-6, "nJ": 1e-9]

struct ChipCounters {
  let subscription: OpaquePointer
  let channels: CFMutableDictionary
  let sample: Sample
  let delta: Delta
  let value: Value
  let name: Label
  let unit: Label

  init?() {
    let library = dlopen("/usr/lib/libIOReport.dylib", RTLD_NOW)
    func load<T>(_ symbol: String, _ type: T.Type) -> T? {
      dlsym(library, symbol).map { unsafeBitCast($0, to: type) }
    }
    guard library != nil,
      let copy = load("IOReportCopyChannelsInGroup", CopyChannels.self),
      let subscribe = load("IOReportCreateSubscription", Subscribe.self),
      let sample = load("IOReportCreateSamples", Sample.self),
      let delta = load("IOReportCreateSamplesDelta", Delta.self),
      let value = load("IOReportSimpleGetIntegerValue", Value.self),
      let name = load("IOReportChannelGetChannelName", Label.self),
      let unit = load("IOReportChannelGetUnitLabel", Label.self),
      let wanted = copy("Energy Model" as CFString, nil, 0, 0, 0)?.takeRetainedValue(),
      let mutable = CFDictionaryCreateMutableCopy(kCFAllocatorDefault, 0, wanted)
    else { return nil }
    var subscribed: Unmanaged<CFMutableDictionary>?
    guard let subscription = subscribe(nil, mutable, &subscribed, 0, nil), let subscribed
    else { return nil }
    self.subscription = subscription
    channels = subscribed.takeRetainedValue()
    (self.sample, self.delta, self.value, self.name, self.unit) = (sample, delta, value, name, unit)
  }

  func read() -> CFDictionary? { sample(subscription, channels, nil)?.takeRetainedValue() }

  func joules(from before: CFDictionary, to after: CFDictionary) -> [String: Double] {
    guard let change = delta(before, after, nil)?.takeRetainedValue() else { return [:] }
    var parts: [String: Double] = [:]
    for channel in (change as NSDictionary)["IOReportChannels"] as? [NSDictionary] ?? [] {
      let channel = channel as CFDictionary
      let label = (unit(channel)?.takeUnretainedValue() as String?) ?? ""
      guard let part = chipParts[(name(channel)?.takeUnretainedValue() as String?) ?? ""],
        let scale = joulesPerUnit[label.trimmingCharacters(in: .whitespaces)]
      else { continue }
      parts[part, default: 0] += Double(value(channel, 0)) * scale
    }
    return parts.mapValues(round3)
  }
}

// A pid file holds the session id of the claude process with that pid, written at each prompt.
func sessions(alive: Set<Int32>) -> [Int32: String] {
  var found: [Int32: String] = [:]
  for name in (try? FileManager.default.contentsOfDirectory(atPath: pidDir)) ?? [] {
    guard let pid = Int32(name) else { continue }
    let file = pidDir + "/" + name
    guard alive.contains(pid) else {
      try? FileManager.default.removeItem(atPath: file)
      continue
    }
    if let id = try? String(contentsOfFile: file, encoding: .utf8)
      .trimmingCharacters(in: .whitespacesAndNewlines), !id.isEmpty
    {
      found[pid] = id
    }
  }
  return found
}

func snapshot(_ gpu: [Int32: UInt64]) -> [Int32: Proc] {
  var procs: [Int32: Proc] = [:]
  for pid in pids() where pid > 0 {
    guard let ppid = parent(pid), let info = usage(pid) else { continue }
    procs[pid] = Proc(
      ppid: ppid, start: info.ri_proc_start_abstime, energy: info.ri_energy_nj,
      cpu: info.ri_user_time + info.ri_system_time,
      child: info.ri_child_user_time + info.ri_child_system_time, gpu: gpu[pid] ?? 0)
  }
  return procs
}

struct Totals {
  var joules = 0.0, cpu = 0.0, unseen = 0.0, gpu = 0.0
}

struct Use: Encodable {
  let j, c, u, uj, g: Double
}

struct Line: Encodable {
  let t: Int
  let dt, w, b: Double
  let pct: Int
  let r, cs, gt: Double
  let e: [String: Double]?
  let g: [String: Use]
}

func group(_ pid: Int32, _ procs: [Int32: Proc], _ owners: [Int32: String],
  _ memo: inout [Int32: String]) -> String
{
  var chain: [Int32] = []
  var current = pid
  var name = "unknown"
  while true {
    if let known = memo[current] { name = known; break }
    chain.append(current)
    if let id = owners[current] { name = "session:" + id; break }
    guard let proc = procs[current] else { break }
    if proc.ppid <= 1 || procs[proc.ppid] == nil {
      name = appName(path(current, proc.start))
      break
    }
    current = proc.ppid
  }
  for link in chain { memo[link] = name }
  return name
}

func logFile(_ date: Date) -> String {
  let format = DateFormatter()
  format.dateFormat = "yyyy-MM-dd"
  return logDir + "/" + format.string(from: date) + ".jsonl"
}

func prune(_ now: Date) {
  let cutoff = now.addingTimeInterval(-Double(keepDays) * 86400)
  for name in (try? FileManager.default.contentsOfDirectory(atPath: logDir)) ?? []
  where name.hasSuffix(".jsonl") {
    let file = logDir + "/" + name
    if let modified = try? FileManager.default.attributesOfItem(atPath: file)[.modificationDate]
      as? Date, modified < cutoff
    {
      try? FileManager.default.removeItem(atPath: file)
    }
  }
}

func round3(_ value: Double) -> Double { (value * 1000).rounded() / 1000 }

// A short command costs several times the background average per CPU second. Measured on a
// 2026 MacBook Air: grep and yes at 5.6 to 6.4 joules, a tight loop in this process at 2.3, so
// the rate comes from timing a real command.
func busyCoreRate() -> Double {
  let command = Process()
  command.executableURL = URL(fileURLWithPath: "/usr/bin/yes")
  command.standardOutput = FileHandle.nullDevice
  guard (try? command.run()) != nil else { return 0 }
  defer {
    command.terminate()
    command.waitUntilExit()
  }
  Thread.sleep(forTimeInterval: 0.5)
  guard let info = usage(command.processIdentifier) else { return 0 }
  let cpu = seconds(info.ri_user_time + info.ri_system_time)
  return cpu > 0 ? Double(info.ri_energy_nj) / 1e9 / cpu : 0
}

let rate = busyCoreRate()
let encoder = JSONEncoder()
encoder.outputFormatting = .sortedKeys
var previous: [Int32: Proc] = [:]
var previousGPU: [Int32: UInt64] = [:]
var previousWatts = 0.0
var previousBattery: Battery?
var previousCPU = cpuTicks()
let chip = ChipCounters()
var previousChip: CFDictionary?
var previousTime = Date()
var previousTicks: UInt64 = 0
var lastPrune = ""
var written = 0

while samples == 0 || written < samples {
  let now = Date()
  let ticks = mach_absolute_time()
  let power = battery()
  guard always || power?.external == false else {
    previous = [:]
    Thread.sleep(forTimeInterval: interval * 3)
    continue
  }
  let gpu = gpuTimes()
  let cpu = cpuTicks()
  let chipNow = chip?.read()
  let procs = snapshot(gpu)
  let watts = power?.watts ?? 0
  defer {
    previous = procs
    previousGPU = gpu
    previousCPU = cpu
    previousChip = chipNow
    previousTime = now
    previousTicks = ticks
    previousWatts = watts
    previousBattery = power
  }
  if previous.isEmpty {
    Thread.sleep(forTimeInterval: interval)
    continue
  }
  let owners = sessions(alive: Set(procs.keys))
  if paths.count > 5000 { paths = [:] }
  var memo: [Int32: String] = [:]
  var groups: [String: Totals] = [:]
  var childGain: [Int32: Double] = [:]
  for (pid, proc) in procs {
    let name = group(pid, procs, owners, &memo)
    var joules = 0.0, cpu = 0.0, gpu = 0.0
    if let before = previous[pid], before.start == proc.start {
      joules = Double(proc.energy &- before.energy) / 1e9
      cpu = seconds(proc.cpu &- before.cpu)
      gpu = Double(proc.gpu &- min(before.gpu, proc.gpu)) / 1e9
      childGain[pid] = seconds(proc.child &- before.child)
    } else if proc.start > previousTicks {
      joules = Double(proc.energy) / 1e9
      cpu = seconds(proc.cpu)
      gpu = Double(proc.gpu) / 1e9
      childGain[pid] = seconds(proc.child)
    } else {
      continue
    }
    groups[name, default: Totals()].joules += joules
    groups[name, default: Totals()].cpu += cpu
    groups[name, default: Totals()].gpu += gpu
  }
  // A process that ended was reaped into its parent's child time, lifetime and all, so what the
  // last line did not already count shows up as the rest of that gain.
  for (pid, before) in previous where procs[pid]?.start != before.start {
    var ancestor = before.ppid
    while ancestor > 1, childGain[ancestor] == nil, let up = previous[ancestor] {
      ancestor = up.ppid
    }
    childGain[ancestor, default: 0] -= seconds(before.cpu + before.child)
  }
  for (pid, gain) in childGain where gain > 0 && procs[pid] != nil {
    let name = group(pid, procs, owners, &memo)
    groups[name, default: Totals()].unseen += gain
  }
  for (name, totals) in groups
  where !name.hasPrefix("session:") && totals.joules + totals.unseen * rate < 0.05
    && totals.gpu < 0.01
  {
    groups[name] = nil
    groups["other", default: Totals()].joules += totals.joules
    groups["other", default: Totals()].cpu += totals.cpu
    groups["other", default: Totals()].unseen += totals.unseen
    groups["other", default: Totals()].gpu += totals.gpu
  }
  var g: [String: Use] = [:]
  for (name, totals) in groups where totals.joules >= 0.001 || totals.unseen >= 0.001 {
    g[name] = Use(
      j: round3(totals.joules), c: round3(totals.cpu), u: round3(totals.unseen),
      uj: round3(totals.unseen * rate), g: round3(totals.gpu))
  }
  var allGPU: UInt64 = 0
  for (pid, time) in gpu {
    allGPU += time &- min(previousGPU[pid] ?? 0, time)
  }
  let dt = now.timeIntervalSince(previousTime)
  var charged = 0.0
  if let power, let before = previousBattery, power.charge > 0, before.charge > 0 {
    charged = Double(before.charge - power.charge) * (power.volts + before.volts) / 2 * 3.6
  }
  let allTicks = cpu.all &- previousCPU.all
  let busyCPU = allTicks > 0
    ? Double(cpu.busy &- previousCPU.busy) / Double(allTicks) * Double(cpu.cores) * dt : 0
  var parts: [String: Double]?
  if let chip, let previousChip, let chipNow {
    parts = chip.joules(from: previousChip, to: chipNow)
  }
  let line = Line(
    t: Int(now.timeIntervalSince1970), dt: round3(dt), w: round3((watts + previousWatts) / 2),
    b: round3(charged), pct: power?.percent ?? 0, r: round3(rate), cs: round3(busyCPU),
    gt: round3(Double(allGPU) / 1e9), e: parts, g: g)
  if let data = try? encoder.encode(line) {
    let file = logFile(now)
    if !FileManager.default.fileExists(atPath: file) {
      FileManager.default.createFile(atPath: file, contents: nil)
    }
    if let handle = FileHandle(forWritingAtPath: file) {
      handle.seekToEndOfFile()
      handle.write(data + Data("\n".utf8))
      handle.closeFile()
    }
    written += 1
  }
  let day = logFile(now)
  if day != lastPrune {
    prune(now)
    lastPrune = day
  }
  Thread.sleep(forTimeInterval: interval)
}

import AppKit
import CoreWLAN
import IOKit.ps
import ServiceManagement

enum Level: Int, Comparable {
    case ok, warn, bad
    static func < (a: Level, b: Level) -> Bool { a.rawValue < b.rawValue }
}

enum Network: String {
    case wifi = "Wi-Fi", hotspot = "iPhone hotspot", wired = "cable or USB", offline
}

let wifiName = CWWiFiClient.shared().interface()?.interfaceName

// Online means an en* interface holds an address a network handed out: a VPN tunnel (utun)
// or a self-assigned 169.254 address does not count.
func currentNetwork() -> Network {
    var list: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&list) == 0 else { return .offline }
    defer { freeifaddrs(list) }
    let upAndRunning = UInt32(IFF_UP | IFF_RUNNING)
    var found: [(name: String, ipv4: UInt32?)] = []
    var next = list
    while let a = next?.pointee {
        next = a.ifa_next
        let name = String(cString: a.ifa_name)
        guard name.hasPrefix("en"), a.ifa_flags & upAndRunning == upAndRunning, let addr = a.ifa_addr else { continue }
        switch Int32(addr.pointee.sa_family) {
        case AF_INET:
            let ip = addr.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { UInt32(bigEndian: $0.pointee.sin_addr.s_addr) }
            if ip >> 16 != 0xA9FE { found.append((name, ip)) }
        case AF_INET6:
            let bytes = addr.withMemoryRebound(to: sockaddr_in6.self, capacity: 1) { $0.pointee.sin6_addr.__u6_addr.__u6_addr8 }
            if !(bytes.0 == 0xFE && bytes.1 & 0xC0 == 0x80) { found.append((name, nil)) }
        default:
            break
        }
    }
    if found.isEmpty { return .offline }
    // An iPhone hotspot hands out 172.20.10.0/28, over Wi-Fi and USB alike.
    if found.contains(where: { ($0.ipv4 ?? 0) >> 4 == 0xAC140A0 }) { return .hotspot }
    return found.contains { $0.name == wifiName } ? .wifi : .wired
}

struct Badge {
    let symbol: String
    let color: NSColor

    static let cpu = Badge(symbol: fullGauge, color: .systemRed)
    static let memory = Badge(symbol: "memorychip", color: .systemRed)
    static let heat = Badge(symbol: "thermometer.high", color: .systemRed)
    static let disk = Badge(symbol: "internaldrive", color: .systemRed)
    static let offline = Badge(symbol: "wifi.slash", color: .systemBlue)
    static let noInternet = Badge(symbol: "wifi.exclamationmark", color: .systemBlue)
    static let busy = Badge(symbol: "arrow.up.arrow.down", color: .systemOrange)
    static let hotspot = Badge(symbol: "personalhotspot", color: .systemGreen)
    static let all = [cpu, memory, heat, disk, offline, noInternet, busy, hotspot]
}

let gigabyte: Int64 = 1 << 30

struct Battery {
    var percent: Int
    var plugged: Bool
    var charging: Bool
    var minutes: Int?

    var tint: NSColor? { percent <= 10 ? .systemRed : percent <= 20 ? .systemYellow : nil }
    var name: String {
        let time = minutes.map { String(format: ", %d:%02d ", $0 / 60, $0 % 60) + (charging ? "until full" : "left") } ?? ""
        let state = charging ? "charging" : plugged ? "on power, not charging" : "on battery"
        return "\(percent)%, \(state)\(time)"
    }
}

func readBattery() -> Battery? {
    guard let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
          let sources = IOPSCopyPowerSourcesList(info)?.takeRetainedValue() as? [CFTypeRef] else { return nil }
    for source in sources {
        guard let d = IOPSGetPowerSourceDescription(info, source)?.takeUnretainedValue() as? [String: Any],
              d[kIOPSTypeKey] as? String == kIOPSInternalBatteryType,
              let now = d[kIOPSCurrentCapacityKey] as? Int,
              let full = d[kIOPSMaxCapacityKey] as? Int, full > 0 else { continue }
        let charging = d[kIOPSIsChargingKey] as? Bool ?? false
        let plugged = d[kIOPSPowerSourceStateKey] as? String == kIOPSACPowerValue
        // Minutes, -1 while macOS is still working the time out and 0 for the one that does not apply.
        let minutes = d[charging ? kIOPSTimeToFullChargeKey : kIOPSTimeToEmptyKey] as? Int ?? 0
        return Battery(percent: now * 100 / full, plugged: plugged, charging: charging,
                       minutes: minutes > 0 && (charging || !plugged) ? minutes : nil)
    }
    return nil
}

struct Reading {
    var network: Network
    var cpu: Double
    var cpuNow: Double
    var pressure: Int32
    var memUsed: UInt64
    var memTotal: UInt64
    var swapUsed: UInt64
    var thermal: ProcessInfo.ThermalState
    var load: Double
    var diskFree: Int64
    var netRate: Double
    var internetDown = false

    var cpuLevel: Level { cpu >= 90 ? .bad : cpu >= 70 ? .warn : .ok }
    // kern.memorystatus_vm_pressure_level: 1 normal, 2 warning, 4 critical
    var memLevel: Level { pressure >= 4 ? .bad : pressure >= 2 ? .warn : .ok }
    var heatLevel: Level {
        switch thermal {
        case .critical: return .bad
        case .serious: return .warn
        default: return .ok
        }
    }
    var diskLevel: Level { diskFree < 0 ? .ok : diskFree < 10 * gigabyte ? .bad : diskFree < 20 * gigabyte ? .warn : .ok }
    var level: Level { max(cpuLevel, memLevel, heatLevel, diskLevel) }
    var offline: Bool { network == .offline }
    // About the hotspot's top speed, measured on 2026-10-23, and mobile data.
    var netBusy: Bool { network == .hotspot && netRate >= 1_000_000 }

    // The menu bar shows one symbol, so only the first that applies.
    var badge: Badge? {
        if cpuLevel == .bad { return .cpu }
        if memLevel == .bad { return .memory }
        if heatLevel == .bad { return .heat }
        if diskLevel == .bad { return .disk }
        if offline { return .offline }
        if internetDown { return .noInternet }
        if netBusy { return .busy }
        if network == .hotspot { return .hotspot }
        return nil
    }
    var diskName: String { diskFree < 0 ? "unknown" : size(UInt64(diskFree)) + " free" }

    var pressureName: String {
        switch pressure {
        case 1: return "normal"
        case 2: return "warning"
        case 4: return "critical"
        default: return "unknown"
        }
    }
    var heatName: String {
        switch thermal {
        case .nominal: return "normal"
        case .fair: return "warm"
        case .serious: return "throttling"
        case .critical: return "critical"
        @unknown default: return "unknown"
        }
    }

    var summary: String {
        String(format: "CPU %.0f%%, memory %@, heat %@", cpuNow, pressureName, heatName)
    }
    var reasons: String {
        var list: [String] = []
        if cpuLevel > .ok { list.append(String(format: "CPU %.0f%%", cpu)) }
        if memLevel > .ok { list.append("memory pressure \(pressureName)") }
        if heatLevel > .ok { list.append("heat \(heatName)") }
        if diskLevel > .ok { list.append("disk " + diskName) }
        return list.joined(separator: ", ")
    }
    var headline: String {
        let load: String
        switch level {
        case .ok: load = String(format: "All good, CPU %.0f%%", cpu)
        case .warn: load = "Busy: " + reasons
        case .bad: load = "Overloaded: " + reasons
        }
        let net: String?
        if offline {
            net = "Offline"
        } else if internetDown {
            net = "\(network.rawValue) joined, internet not answering"
        } else if netBusy {
            net = "iPhone hotspot busy, " + rate(netRate)
        } else {
            net = network == .hotspot ? "On iPhone hotspot" : nil
        }
        return net.map { $0 + ". " + load } ?? load
    }
}

final class Sampler {
    private let host = mach_host_self()
    private var lastTicks: [UInt32]?
    private var history: [Double] = []

    func sample() -> Reading? {
        guard let now = cpuNow() else { return nil }
        history.append(now)
        if history.count > 3 { history.removeFirst() }
        let mem = memory()
        var load = [Double](repeating: 0, count: 3)
        getloadavg(&load, 3)
        return Reading(
            network: currentNetwork(),
            cpu: history.reduce(0, +) / Double(history.count),
            cpuNow: now,
            pressure: sysctlInt32("kern.memorystatus_vm_pressure_level"),
            memUsed: mem,
            memTotal: ProcessInfo.processInfo.physicalMemory,
            swapUsed: swapUsed(),
            thermal: ProcessInfo.processInfo.thermalState,
            load: load[0],
            diskFree: diskFree(),
            netRate: netRate())
    }

    // Bytes on en* only, so a VPN tunnel's packets are not counted twice. The interface counters
    // are 32 bits and wrap, so each tick adds its own difference to a running total.
    private var lastBytes: [String: (UInt32, UInt32)] = [:]
    private var total: UInt64 = 0
    private var traffic: [(at: UInt64, total: UInt64)] = []

    private func netRate() -> Double {
        var list: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&list) == 0 else { return 0 }
        defer { freeifaddrs(list) }
        var seen: [String: (UInt32, UInt32)] = [:]
        var next = list
        while let a = next?.pointee {
            next = a.ifa_next
            let name = String(cString: a.ifa_name)
            guard name.hasPrefix("en"), a.ifa_addr?.pointee.sa_family == UInt8(AF_LINK), let data = a.ifa_data else { continue }
            let d = data.assumingMemoryBound(to: if_data.self).pointee
            seen[name] = (d.ifi_ibytes, d.ifi_obytes)
            if let last = lastBytes[name] {
                total += UInt64(d.ifi_ibytes &- last.0) + UInt64(d.ifi_obytes &- last.1)
            }
        }
        lastBytes = seen
        let now = DispatchTime.now().uptimeNanoseconds
        traffic.append((now, total))
        traffic.removeAll { now - $0.at > 11_000_000_000 }
        guard let first = traffic.first, now - first.at >= 9_000_000_000 else { return 0 }
        return Double(total - first.total) / (Double(now - first.at) / 1e9)
    }

    // Counts purgeable space as free, as Finder does, so a full cache alone does not turn it red.
    private var disk: (free: Int64, at: Date)?
    private func diskFree() -> Int64 {
        if let disk, Date().timeIntervalSince(disk.at) < 30 { return disk.free }
        let values = try? URL(fileURLWithPath: "/").resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        let free = values?.volumeAvailableCapacityForImportantUsage ?? -1
        disk = (free, Date())
        return free
    }

    private func cpuNow() -> Double? {
        var info = host_cpu_load_info()
        var count = mach_msg_type_number_t(MemoryLayout<host_cpu_load_info>.stride / MemoryLayout<integer_t>.stride)
        let kr = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                host_statistics(host, HOST_CPU_LOAD_INFO, $0, &count)
            }
        }
        guard kr == KERN_SUCCESS else { return nil }
        let ticks = [info.cpu_ticks.0, info.cpu_ticks.1, info.cpu_ticks.2, info.cpu_ticks.3]
        defer { lastTicks = ticks }
        guard let last = lastTicks else { return nil }
        let delta = zip(ticks, last).map { Double($0 &- $1) }
        let total = delta.reduce(0, +)
        guard total > 0 else { return nil }
        return 100 * (total - delta[Int(CPU_STATE_IDLE)]) / total
    }

    // Same sum as Activity Monitor's "Memory Used": app memory + wired + compressed.
    private func memory() -> UInt64 {
        var stats = vm_statistics64()
        var count = mach_msg_type_number_t(MemoryLayout<vm_statistics64>.stride / MemoryLayout<integer_t>.stride)
        let kr = withUnsafeMutablePointer(to: &stats) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                host_statistics64(host, HOST_VM_INFO64, $0, &count)
            }
        }
        guard kr == KERN_SUCCESS else { return 0 }
        let app = Int64(stats.internal_page_count) - Int64(stats.purgeable_count)
        let pages = max(app, 0) + Int64(stats.wire_count) + Int64(stats.compressor_page_count)
        return UInt64(pages) * UInt64(sysconf(_SC_PAGESIZE))
    }

    private func swapUsed() -> UInt64 {
        var usage = xsw_usage()
        var size = MemoryLayout<xsw_usage>.size
        guard sysctlbyname("vm.swapusage", &usage, &size, nil, 0) == 0 else { return 0 }
        return usage.xsu_used
    }

    private func sysctlInt32(_ name: String) -> Int32 {
        var value: Int32 = 0
        var size = MemoryLayout<Int32>.size
        guard sysctlbyname(name, &value, &size, nil, 0) == 0 else { return 0 }
        return value
    }
}

struct Proc {
    var name: String
    var cpu = 0.0
    var mem: UInt64 = 0
}

// Helpers are counted under the app bundle they live in, so "Claude" rather than 20 renderers.
func readProcesses() -> [Proc] {
    let ps = Process()
    ps.executableURL = URL(fileURLWithPath: "/bin/ps")
    ps.arguments = ["-Aeo", "pcpu=,rss=,comm="]
    let out = Pipe()
    ps.standardOutput = out
    ps.standardError = FileHandle.nullDevice
    guard (try? ps.run()) != nil else { return [] }
    let data = out.fileHandleForReading.readDataToEndOfFile()
    ps.waitUntilExit()
    var byName: [String: Proc] = [:]
    for line in String(decoding: data, as: UTF8.self).split(separator: "\n") {
        let fields = line.split(separator: " ", maxSplits: 2)
        guard fields.count == 3, let cpu = Double(fields[0]), let rss = UInt64(fields[1]) else { continue }
        let name = appName(path: fields[2].trimmingCharacters(in: .whitespaces))
        byName[name, default: Proc(name: name)].cpu += cpu
        byName[name]!.mem += rss * 1024
    }
    return Array(byName.values)
}

func appName(path: String) -> String {
    let parts = path.split(separator: "/")
    let bundle = parts.first { $0.hasSuffix(".app") }.map { String($0.dropLast(4)) }
    return bundle ?? String(parts.last ?? "?")
}

func appName(pid: Int32) -> String? {
    var buffer = [CChar](repeating: 0, count: 4096)
    guard proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 else { return nil }
    return appName(path: String(cString: buffer))
}

// The app that moved the most bytes over 2 s, helpers counted under their app as in readProcesses.
func topNetworkApp() -> String? {
    let nettop = Process()
    nettop.executableURL = URL(fileURLWithPath: "/usr/bin/nettop")
    nettop.arguments = ["-P", "-d", "-x", "-t", "external", "-L", "2", "-s", "2", "-J", "bytes_in,bytes_out"]
    let out = Pipe()
    nettop.standardOutput = out
    nettop.standardError = FileHandle.nullDevice
    guard (try? nettop.run()) != nil else { return nil }
    let data = out.fileHandleForReading.readDataToEndOfFile()
    nettop.waitUntilExit()
    // The first sample counts since each process started, the second only the last 2 s.
    guard let last = String(decoding: data, as: UTF8.self).components(separatedBy: ",bytes_in,bytes_out,").last else { return nil }
    var byApp: [String: UInt64] = [:]
    for line in last.split(separator: "\n") {
        let f = line.split(separator: ",", omittingEmptySubsequences: false)
        guard f.count >= 3, let dot = f[0].lastIndex(of: "."), let pid = Int32(f[0][f[0].index(after: dot)...]),
              let bytesIn = UInt64(f[1]), let bytesOut = UInt64(f[2]) else { continue }
        byApp[appName(pid: pid) ?? String(f[0][..<dot]), default: 0] += bytesIn + bytesOut
    }
    guard let top = byApp.max(by: { $0.value < $1.value }), top.value > 0 else { return nil }
    return top.key
}

// Apple's captive portal check: a 69 byte page that says Success when the internet answers, so
// about 1 KB a check with the handshake. Info.plist allows plain HTTP for this host alone.
final class Probe {
    private(set) var down = false
    private var failures = 0
    private var nextCheck = Date()
    private var running = false
    private let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 2
        config.timeoutIntervalForResource = 2
        config.waitsForConnectivity = false
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: config)
    }()

    func recheck() { nextCheck = Date() }

    // Every 30 s, every 10 s while failing; down after two failures in a row, so one lost packet
    // on mobile data does not flash the symbol.
    func poll(offline: Bool) {
        if offline {
            down = false
            failures = 0
            return
        }
        guard !running, Date() >= nextCheck else { return }
        running = true
        check { ok in
            DispatchQueue.main.async {
                self.running = false
                self.failures = ok ? 0 : self.failures + 1
                self.down = self.failures >= 2
                self.nextCheck = Date().addingTimeInterval(ok ? 30 : 10)
            }
        }
    }

    func check(_ done: @escaping (Bool) -> Void) {
        session.dataTask(with: URL(string: "http://captive.apple.com/hotspot-detect.html")!) { data, response, _ in
            let ok = (response as? HTTPURLResponse)?.statusCode == 200
                && String(decoding: data ?? Data(), as: UTF8.self).contains("Success")
            done(ok)
        }.resume()
    }
}

func rate(_ bytesPerSecond: Double) -> String {
    bytesPerSecond >= 1e6
        ? String(format: "%.1f MB/s", bytesPerSecond / 1e6)
        : String(format: "%.0f KB/s", bytesPerSecond / 1e3)
}

func size(_ bytes: UInt64) -> String {
    let gb = Double(bytes) / 1_073_741_824
    return gb >= 1 ? String(format: "%.1f GB", gb) : String(format: "%.0f MB", gb * 1024)
}

let cores = Double(ProcessInfo.processInfo.activeProcessorCount)
let fullGauge = "gauge.with.dots.needle.100percent"

// SF Symbols has the needle at five fixed positions only.
func gauge(_ cpu: Double) -> NSImage? {
    let step = cpu < 17 ? 0 : cpu < 42 ? 33 : cpu < 58 ? 50 : cpu < 83 ? 67 : 100
    let image = NSImage(systemSymbolName: "gauge.with.dots.needle.\(step)percent", accessibilityDescription: "Load")
    image?.isTemplate = true
    return image
}

func badgeImage(_ badge: Badge) -> NSImage? {
    let config = NSImage.SymbolConfiguration(pointSize: NSFont.systemFontSize, weight: .semibold)
        .applying(NSImage.SymbolConfiguration(paletteColors: [badge.color]))
    let image = NSImage(systemSymbolName: badge.symbol, accessibilityDescription: nil)?.withSymbolConfiguration(config)
    image?.isTemplate = false
    return image
}

// Monospaced digits keep the item's width, and so its neighbours, still while the percent changes.
let batteryFont: NSFont = {
    let base = NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .bold)
    return base.fontDescriptor.withDesign(.rounded).flatMap { NSFont(descriptor: $0, size: 11) } ?? base
}()

// The percent over a bar as full as the battery, so the level never runs through the digits.
// Without a tint the image is a template and ink only stands for the menu bar's text colour.
func batteryImage(_ battery: Battery, ink: NSColor = .black) -> NSImage {
    let color = battery.tint ?? ink
    let digits = NSAttributedString(string: "\(battery.percent)", attributes: [.font: batteryFont, .foregroundColor: color])
    let config = NSImage.SymbolConfiguration(pointSize: 7.5, weight: .bold)
        .applying(NSImage.SymbolConfiguration(paletteColors: [color]))
    let bolt = battery.plugged
        ? NSImage(systemSymbolName: "bolt.fill", accessibilityDescription: nil)?.withSymbolConfiguration(config) : nil
    let width = ceil(digits.size().width)
    let size = NSSize(width: width + (bolt.map { 1.5 + $0.size.width } ?? 0), height: 22)
    let image = NSImage(size: size, flipped: false) { _ in
        digits.draw(at: NSPoint(x: 0, y: 13 - batteryFont.capHeight / 2 + batteryFont.descender))
        var bar = NSRect(x: 0, y: 4.5, width: width, height: 2)
        color.withAlphaComponent(0.35).setFill()
        NSBezierPath(roundedRect: bar, xRadius: 1, yRadius: 1).fill()
        bar.size.width = max(width * CGFloat(battery.percent) / 100, 2)
        color.setFill()
        NSBezierPath(roundedRect: bar, xRadius: 1, yRadius: 1).fill()
        if let bolt {
            bolt.draw(in: NSRect(origin: NSPoint(x: width + 1.5, y: 13 - bolt.size.height / 2), size: bolt.size))
        }
        return true
    }
    image.isTemplate = battery.tint == nil
    return image
}

let batteryStates = [(100, false), (100, true), (68, false), (68, true), (35, false), (20, false), (10, false), (5, true)]
    .map { Battery(percent: $0.0, plugged: $0.1, charging: $0.1, minutes: nil) }

// Images side by side on a menu bar coloured strip, to check them without waiting for each state.
func strip(_ images: [NSImage], dark: Bool) -> NSImage {
    let width = images.reduce(8) { $0 + $1.size.width + 12 }
    return NSImage(size: NSSize(width: width - 4, height: 24), flipped: false) { rect in
        NSColor(white: dark ? 0.15 : 0.92, alpha: 1).setFill()
        rect.fill()
        var x: CGFloat = 8
        for image in images {
            image.draw(in: NSRect(origin: NSPoint(x: x, y: (rect.height - image.size.height) / 2), size: image.size))
            x += image.size.width + 12
        }
        return true
    }
}

func appIcon() -> NSImage {
    NSImage(size: NSSize(width: 1024, height: 1024), flipped: false) { _ in
        // Apple's macOS icon grid: an 824 pt body with a 185 pt corner radius on a 1024 pt canvas.
        let body = NSBezierPath(roundedRect: NSRect(x: 100, y: 100, width: 824, height: 824), xRadius: 185, yRadius: 185)
        NSGradient(starting: NSColor(srgbRed: 1, green: 0.36, blue: 0.3, alpha: 1),
                   ending: NSColor(srgbRed: 0.76, green: 0.1, blue: 0.08, alpha: 1))?.draw(in: body, angle: -90)
        let config = NSImage.SymbolConfiguration(pointSize: 420, weight: .semibold)
            .applying(NSImage.SymbolConfiguration(paletteColors: [.white]))
        if let symbol = NSImage(systemSymbolName: fullGauge, accessibilityDescription: nil)?.withSymbolConfiguration(config) {
            let s = symbol.size
            symbol.draw(in: NSRect(x: 512 - s.width / 2, y: 512 - s.height / 2, width: s.width, height: s.height))
        }
        return true
    }
}

func png(_ image: NSImage, scale: CGFloat) -> Data? {
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: Int(image.size.width * scale), pixelsHigh: Int(image.size.height * scale),
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
    rep.size = image.size
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSGraphicsContext.current?.imageInterpolation = .high
    image.draw(in: NSRect(origin: .zero, size: image.size))
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])
}

final class Monitor: NSObject, NSMenuDelegate, NSApplicationDelegate {
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let batteryItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private var battery: Battery?
    private let sampler = Sampler()
    private let probe = Probe()
    private var reading: Reading?
    private var topNet: String?
    private var topNetAt = Date.distantPast
    private var events: [(Date, String)] = []
    // DispatchTime runs on uptime, which stops while the Mac sleeps, so a long gap means a stall.
    private var lastTick = DispatchTime.now().uptimeNanoseconds
    private var asleep = false
    private var menuOpen = false
    private var peekUntil = Date()
    private var activity: NSObjectProtocol?
    private let clock: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f
    }()

    func start() {
        // Without this App Nap throttles the timer and every reading looks like a freeze.
        activity = ProcessInfo.processInfo.beginActivity(
            options: .userInitiatedAllowingIdleSystemSleep, reason: "Live load readings")
        for item in [item, batteryItem] {
            let menu = NSMenu()
            menu.delegate = self
            menu.autoenablesItems = false
            item.menu = menu
            item.button?.imagePosition = .imageOnly
        }
        item.button?.image = gauge(0)
        batteryItem.autosaveName = "battery"
        batteryItem.isVisible = false
        let ws = NSWorkspace.shared.notificationCenter
        ws.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in
            self?.asleep = true
        }
        ws.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.asleep = false
            self?.lastTick = DispatchTime.now().uptimeNanoseconds
        }
        let timer = Timer(timeInterval: 2, repeats: true) { [weak self] _ in self?.tick() }
        timer.tolerance = 0.2
        RunLoop.main.add(timer, forMode: .common)
        peek()
        tick()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        peek()
        return false
    }

    // The item hides unless it has a badge, so opening the app again shows it for a while to reach the menu.
    private func peek() {
        peekUntil = Date().addingTimeInterval(20)
        refresh()
    }

    private func refresh() {
        let visible = menuOpen || reading?.badge != nil || Date() < peekUntil
        // Redrawing the calm state right before hiding flashes it while the item animates out.
        if visible, let r = reading { draw(r) }
        if visible != item.isVisible {
            NSLog("menu bar item %@", visible ? "shown" : "hidden")
            if visible {
                DispatchQueue.main.async { [weak self] in
                    NSLog("menu bar item %.0f pt wide", self?.item.button?.frame.width ?? 0)
                }
            }
        }
        item.isVisible = visible
    }

    private func tick() {
        let now = DispatchTime.now().uptimeNanoseconds
        let gap = Double(now &- lastTick) / 1e9
        lastTick = now
        drawBattery(readBattery())
        guard var r = sampler.sample() else { return }
        if r.network != reading?.network { probe.recheck() }
        probe.poll(offline: r.offline)
        r.internetDown = probe.down
        if !asleep && gap > 8 {
            note(String(format: "froze %.0f s, %@", gap, r.summary))
        }
        if r.level == .bad && (reading?.level ?? .ok) != .bad {
            let top = readProcesses().max { $0.cpu < $1.cpu }?.name ?? "?"
            note("went red: \(r.reasons), top CPU \(top)")
        }
        if r.network != (reading?.network ?? .wifi) {
            note(r.offline ? "went offline" : "on \(r.network.rawValue)")
        }
        if r.internetDown != (reading?.internetDown ?? false) {
            note(r.internetDown ? "internet not answering" : "internet answering again")
        }
        let startedBusy = r.netBusy && !(reading?.netBusy ?? false)
        if startedBusy || (r.netBusy && Date().timeIntervalSince(topNetAt) > 10) {
            topNetAt = Date()
            let speed = rate(r.netRate)
            DispatchQueue.global().async {
                let name = topNetworkApp()
                DispatchQueue.main.async {
                    self.topNet = name
                    if startedBusy { self.note("hotspot busy, \(speed), most by \(name ?? "unknown")") }
                }
            }
        }
        reading = r
        refresh()
    }

    private func note(_ text: String) {
        events.append((Date(), text))
        if events.count > 6 { events.removeFirst() }
    }

    private func draw(_ r: Reading) {
        guard let button = item.button else { return }
        button.toolTip = r.headline
        button.setAccessibilityLabel(r.headline)
        if let badge = r.badge, let image = badgeImage(badge) {
            button.contentTintColor = nil
            button.image = image
        } else {
            button.image = gauge(r.cpu)
            button.contentTintColor = r.level == .warn ? .systemOrange : nil
        }
        // A variable length item pads the symbol by about 8 pt a side; 3 is enough to stay clickable.
        item.length = ceil(button.image?.size.width ?? 16) + 6
    }

    private func drawBattery(_ new: Battery?) {
        let old = battery
        battery = new
        batteryItem.isVisible = new != nil
        guard let new, let button = batteryItem.button else { return }
        button.toolTip = "Battery " + new.name
        button.setAccessibilityLabel("Battery " + new.name)
        if button.image != nil, new.percent == old?.percent, new.plugged == old?.plugged { return }
        let image = batteryImage(new)
        button.image = image
        batteryItem.length = ceil(image.size.width) + 6
    }

    // The battery item's menu must not show the hidden item: the bar would move under the open menu.
    func menuWillOpen(_ menu: NSMenu) { menuOpen = menu === item.menu }

    func menuDidClose(_ menu: NSMenu) {
        menuOpen = false
        refresh()
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        guard let r = reading else { return }
        menu.addItem(text(r.headline, bold: true))
        menu.addItem(.separator())
        menu.addItem(row("CPU", String(format: "%.0f%%, load %.1f on %.0f cores", r.cpu, r.load, cores)))
        menu.addItem(row("Memory", "\(size(r.memUsed)) of \(size(r.memTotal)), pressure \(r.pressureName)"))
        menu.addItem(row("Swap", size(r.swapUsed)))
        menu.addItem(row("Disk", r.diskName))
        menu.addItem(row("Heat", r.heatName))
        if let battery { menu.addItem(row("Battery", battery.name)) }
        var net = r.network.rawValue
        if !r.offline { net += ", " + rate(r.netRate) }
        if r.internetDown { net += ", internet not answering" }
        if r.netBusy, let topNet { net += ", most by " + topNet }
        menu.addItem(row("Network", net))
        let procs = readProcesses()
        menu.addItem(.sectionHeader(title: "Using most CPU"))
        for p in procs.sorted(by: { $0.cpu > $1.cpu }).prefix(3) {
            menu.addItem(row(p.name, String(format: "%.0f%%", p.cpu / cores)))
        }
        menu.addItem(.sectionHeader(title: "Using most memory"))
        for p in procs.sorted(by: { $0.mem > $1.mem }).prefix(3) {
            menu.addItem(row(p.name, size(p.mem)))
        }
        if !events.isEmpty {
            menu.addItem(.sectionHeader(title: "Recent"))
            for (date, event) in events.reversed() {
                menu.addItem(text("\(clock.string(from: date))  \(event)"))
            }
        }
        menu.addItem(.separator())
        menu.addItem(action("Open Activity Monitor", #selector(openActivityMonitor)))
        let login = action("Open at Login", #selector(toggleLogin))
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        menu.addItem(login)
        menu.addItem(action("Quit Overload", #selector(quit), key: "q"))
    }

    private func text(_ string: String, bold: Bool = false) -> NSMenuItem {
        let item = NSMenuItem()
        let font = bold ? NSFont.boldSystemFont(ofSize: 0) : NSFont.menuFont(ofSize: 0)
        item.attributedTitle = NSAttributedString(string: string, attributes: [.font: font])
        return item
    }

    private func row(_ left: String, _ right: String) -> NSMenuItem {
        let style = NSMutableParagraphStyle()
        style.tabStops = [NSTextTab(textAlignment: .right, location: 330)]
        let name = left.count > 28 ? left.prefix(27) + "..." : left
        let item = NSMenuItem()
        item.attributedTitle = NSAttributedString(
            string: "\(name)\t\(right)",
            attributes: [.paragraphStyle: style, .font: NSFont.menuFont(ofSize: 0)])
        return item
    }

    private func action(_ title: String, _ selector: Selector, key: String = "") -> NSMenuItem {
        let item = NSMenuItem(title: title, action: selector, keyEquivalent: key)
        item.target = self
        return item
    }

    @objc private func openActivityMonitor() {
        NSWorkspace.shared.open(URL(fileURLWithPath: "/System/Applications/Utilities/Activity Monitor.app"))
    }

    @objc private func toggleLogin() {
        let service = SMAppService.mainApp
        do {
            if service.status == .enabled {
                try service.unregister()
            } else {
                try service.register()
            }
            if service.status == .requiresApproval { SMAppService.openSystemSettingsLoginItems() }
        } catch {
            NSApp.activate()
            let alert = NSAlert()
            alert.messageText = "Could not change Open at Login"
            alert.informativeText = error.localizedDescription
            alert.runModal()
        }
    }

    @objc private func quit() { NSApp.terminate(nil) }
}

if let i = CommandLine.arguments.firstIndex(of: "--render"), i + 1 < CommandLine.arguments.count {
    let dir = URL(fileURLWithPath: CommandLine.arguments[i + 1])
    let iconset = dir.appendingPathComponent("AppIcon.iconset")
    try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
    // Drawn straight at the smaller sizes the gauge comes out blocky, so they are scaled from one render.
    guard let master = png(appIcon(), scale: 1).flatMap(NSImage.init(data:)) else { exit(1) }
    for points in [16, 32, 128, 256, 512] {
        for scale in [1, 2] {
            let name = "icon_\(points)x\(points)\(scale == 2 ? "@2x" : "").png"
            try png(master, scale: CGFloat(points * scale) / 1024)?.write(to: iconset.appendingPathComponent(name))
        }
    }
    for dark in [true, false] {
        let name = dark ? "dark" : "light"
        try png(strip(Badge.all.compactMap(badgeImage), dark: dark), scale: 4)?
            .write(to: dir.appendingPathComponent("badges-\(name).png"))
        try png(strip(batteryStates.map { batteryImage($0, ink: dark ? .white : .black) }, dark: dark), scale: 4)?
            .write(to: dir.appendingPathComponent("battery-\(name).png"))
    }
    exit(0)
}

if let i = CommandLine.arguments.firstIndex(of: "--check") {
    let seconds = Int(CommandLine.arguments.dropFirst(i + 1).first ?? "") ?? 6
    let sampler = Sampler()
    _ = sampler.sample()
    for _ in 0..<max(seconds / 2, 1) {
        Thread.sleep(forTimeInterval: 2)
        if let r = sampler.sample() {
            print("\(r.level)\t\(r.badge?.symbol ?? "no badge")\t\(r.headline)\t\(size(r.memUsed)) used, swap \(size(r.swapUsed)), disk \(r.diskName), load \(r.load), network \(r.network.rawValue) \(rate(r.netRate))")
        }
    }
    let answered = DispatchSemaphore(value: 0)
    var internet = false
    Probe().check { ok in
        internet = ok
        answered.signal()
    }
    answered.wait()
    print("internet\t\(internet ? "answers" : "not answering")")
    print("battery\t\(readBattery()?.name ?? "none")")
    print("network top\t\(topNetworkApp() ?? "none")")
    let procs = readProcesses()
    for p in procs.sorted(by: { $0.cpu > $1.cpu }).prefix(3) { print(String(format: "cpu\t%@\t%.0f%%", p.name, p.cpu / cores)) }
    for p in procs.sorted(by: { $0.mem > $1.mem }).prefix(3) { print("mem\t\(p.name)\t\(size(p.mem))") }
    exit(0)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let monitor = Monitor()
app.delegate = monitor
monitor.start()
app.run()

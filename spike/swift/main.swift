import AppKit
import Darwin

final class Delegate: NSObject, NSApplicationDelegate {
    var items: [NSStatusItem] = []
    var prevTicks: [UInt32]? = nil
    func cpuTicks() -> [UInt32] {
        var info = host_cpu_load_info()
        var count = mach_msg_type_number_t(MemoryLayout<host_cpu_load_info>.size / MemoryLayout<integer_t>.size)
        _ = withUnsafeMutablePointer(to: &info) { $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { host_statistics(mach_host_self(), HOST_CPU_LOAD_INFO, $0, &count) } }
        return [info.cpu_ticks.0, info.cpu_ticks.1, info.cpu_ticks.2, info.cpu_ticks.3]
    }
    func memUsedG() -> Int {
        var vm = vm_statistics64()
        var count = mach_msg_type_number_t(MemoryLayout<vm_statistics64>.size / MemoryLayout<integer_t>.size)
        _ = withUnsafeMutablePointer(to: &vm) { $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { host_statistics64(mach_host_self(), HOST_VM_INFO64, $0, &count) } }
        var ps: vm_size_t = 0; host_page_size(mach_host_self(), &ps)
        let used = (UInt64(vm.active_count) + UInt64(vm.wire_count) + UInt64(vm.compressor_page_count)) * UInt64(ps)
        return Int((Double(used) / 1073741824.0).rounded())
    }
    func tick() {
        let t = cpuTicks(); var pct = 0.0
        if let p = prevTicks {
            let d = (0..<4).map { Double(t[$0] &- p[$0]) }
            let total = d.reduce(0, +); if total > 0 { pct = 100 * (total - d[2]) / total } // idx2 = IDLE
        }
        prevTicks = t
        items[0].button?.title = "\(memUsedG())G"
        items[1].button?.title = "\(Int(pct.rounded()))%"
        items[2].button?.title = "100%"
    }
    func applicationDidFinishLaunching(_ n: Notification) {
        for name in ["mem", "cpu", "bat"] {
            let it = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
            it.button?.title = name; items.append(it)
            print("TRAY_OK \(name) button=\(it.button != nil)")
        }
        print("SWIFT_TRAYS \(items.count)/3"); fflush(stdout)
        tick()
        Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { _ in self.tick() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 6) {
            print("SWIFT_TITLES " + self.items.map { "\"\($0.button?.title ?? "nil")\"" }.joined(separator: " ")); fflush(stdout)
        }
    }
}
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let d = Delegate(); app.delegate = d
app.run()

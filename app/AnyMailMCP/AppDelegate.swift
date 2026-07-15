import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private let admin = AdminClient()
    private var supervisor: EngineSupervisor?
    private var accounts: [Account] = []
    private var addWindow: AddAccountWindowController?

    nonisolated override init() {
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let nodeOverride = UserDefaults.standard.string(forKey: "nodePath")
        let engineOverride = UserDefaults.standard.string(forKey: "enginePath")
        if let node = NodeLocator.find(override: nodeOverride),
           let entry = EnginePaths.entry(override: engineOverride) {
            supervisor = EngineSupervisor(nodePath: node, entryPath: entry)
        }

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = NSImage(
            systemSymbolName: "envelope.fill",
            accessibilityDescription: "AnyMail MCP"
        )

        supervisor?.onStateChange = { [weak self] in
            self?.rebuildMenu()
            self?.refreshAccounts()
        }
        supervisor?.start()

        rebuildMenu()
        refreshAccounts()
    }

    func applicationWillTerminate(_ notification: Notification) {
        supervisor?.stop()
    }

    // MARK: - Data

    private func refreshAccounts(retries: Int = 12) {
        Task {
            do {
                let list = try await admin.listAccounts()
                accounts = list
                rebuildMenu()
            } catch {
                // Server may still be starting up — retry briefly.
                if retries > 0 {
                    try? await Task.sleep(for: .milliseconds(500))
                    refreshAccounts(retries: retries - 1)
                }
            }
        }
    }

    // MARK: - Menu

    private func rebuildMenu() {
        let menu = NSMenu()

        let running = supervisor?.running ?? false
        let statusText = supervisor == nil
            ? "⚠︎ node / engine not found"
            : (running ? "● Server running · 127.0.0.1:8765" : "○ Server stopped")
        let statusRow = NSMenuItem(title: statusText, action: nil, keyEquivalent: "")
        statusRow.isEnabled = false
        menu.addItem(statusRow)

        if supervisor == nil {
            menu.addItem(item("How to set paths…", #selector(configurePaths)))
        }

        menu.addItem(.separator())

        if accounts.isEmpty {
            let none = NSMenuItem(title: "No accounts connected", action: nil, keyEquivalent: "")
            none.isEnabled = false
            menu.addItem(none)
        } else {
            for account in accounts {
                let title = (account.default ? "★ " : "   ") + account.email
                    + (account.readOnly ? "  · read-only" : "")
                let row = NSMenuItem(title: title, action: nil, keyEquivalent: "")
                let sub = NSMenu()
                let remove = item("Remove \(account.email)", #selector(removeAccount(_:)))
                remove.representedObject = account.email
                sub.addItem(remove)
                row.submenu = sub
                menu.addItem(row)
            }
        }

        menu.addItem(item("Add Account…", #selector(addAccount), key: "n"))
        menu.addItem(.separator())
        menu.addItem(item("Install into Agents", #selector(installAgents)))

        let login = item("Start at Login", #selector(toggleLogin))
        login.state = LoginItem.isEnabled ? .on : .off
        menu.addItem(login)

        menu.addItem(.separator())
        menu.addItem(item("Quit AnyMail MCP", #selector(quit), key: "q"))

        statusItem.menu = menu
    }

    private func item(_ title: String, _ action: Selector, key: String = "") -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
        i.target = self
        return i
    }

    // MARK: - Actions

    @objc private func addAccount() {
        if addWindow == nil {
            addWindow = AddAccountWindowController(admin: admin) { [weak self] in
                self?.refreshAccounts()
            }
        }
        NSApp.activate(ignoringOtherApps: true)
        addWindow?.showWindow(nil)
        addWindow?.window?.makeKeyAndOrderFront(nil)
    }

    @objc private func removeAccount(_ sender: NSMenuItem) {
        guard let email = sender.representedObject as? String else { return }
        Task {
            try? await admin.removeAccount(email: email)
            refreshAccounts()
        }
    }

    @objc private func installAgents() {
        Task {
            do {
                let lines = try await admin.install(all: false)
                alert("Installed into agents", lines.joined(separator: "\n"))
            } catch {
                alert("Install failed", error.localizedDescription)
            }
        }
    }

    @objc private func toggleLogin() {
        do {
            try LoginItem.setEnabled(!LoginItem.isEnabled)
        } catch {
            alert("Couldn't change login item", error.localizedDescription)
        }
        rebuildMenu()
    }

    @objc private func configurePaths() {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        alert(
            "Set node / engine paths",
            """
            Auto-detection failed. Set them in Terminal, then relaunch the app:

            defaults write com.lokilabs.AnyMailMCP nodePath /opt/homebrew/bin/node
            defaults write com.lokilabs.AnyMailMCP enginePath \(home)/loki-labs/anymail-mcp/dist/index.js
            """
        )
    }

    @objc private func quit() {
        supervisor?.stop()
        NSApp.terminate(nil)
    }

    private func alert(_ title: String, _ message: String) {
        let a = NSAlert()
        a.messageText = title
        a.informativeText = message
        a.runModal()
    }
}

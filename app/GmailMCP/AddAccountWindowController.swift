import AppKit

/// Small form window: email + App Password (+ name / flags) → POST /admin/accounts.
@MainActor
final class AddAccountWindowController: NSWindowController {
    private let admin: AdminClient
    private let onDone: @MainActor () -> Void

    private let emailField = NSTextField()
    private let passField = NSSecureTextField()
    private let nameField = NSTextField()
    private let defaultCheck = NSButton(checkboxWithTitle: "Make default", target: nil, action: nil)
    private let readOnlyCheck = NSButton(checkboxWithTitle: "Read-only", target: nil, action: nil)
    private let statusLabel = NSTextField(labelWithString: "")
    private let addButton = NSButton(title: "Add Account", target: nil, action: nil)

    init(admin: AdminClient, onDone: @escaping @MainActor () -> Void) {
        self.admin = admin
        self.onDone = onDone
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 420, height: 300),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "Add Gmail Account"
        super.init(window: window)
        window.center()
        buildUI()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) not used") }

    private func buildUI() {
        guard let content = window?.contentView else { return }

        emailField.placeholderString = "you@gmail.com"
        passField.placeholderString = "App Password"
        nameField.placeholderString = "Display name (optional)"
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.lineBreakMode = .byWordWrapping
        statusLabel.maximumNumberOfLines = 3

        let hint = NSTextField(labelWithString: "App Password: myaccount.google.com/apppasswords (needs 2-Step Verification)")
        hint.textColor = .secondaryLabelColor
        hint.font = .systemFont(ofSize: 11)

        addButton.target = self
        addButton.action = #selector(add)
        addButton.keyEquivalent = "\r"

        let stack = NSStackView(views: [
            labeled("Email", emailField),
            labeled("App Password", passField),
            labeled("Name", nameField),
            hint,
            defaultCheck,
            readOnlyCheck,
            statusLabel,
            addButton,
        ])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 8
        stack.edgeInsets = NSEdgeInsets(top: 16, left: 16, bottom: 16, right: 16)
        stack.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            stack.topAnchor.constraint(equalTo: content.topAnchor),
            stack.bottomAnchor.constraint(equalTo: content.bottomAnchor),
        ])
        for field in [emailField, passField, nameField] {
            field.widthAnchor.constraint(equalToConstant: 300).isActive = true
        }
    }

    private func labeled(_ title: String, _ field: NSView) -> NSView {
        let label = NSTextField(labelWithString: title)
        label.alignment = .right
        label.widthAnchor.constraint(equalToConstant: 90).isActive = true
        let row = NSStackView(views: [label, field])
        row.orientation = .horizontal
        row.spacing = 8
        return row
    }

    @objc private func add() {
        let email = emailField.stringValue.trimmingCharacters(in: .whitespaces)
        let pass = passField.stringValue
        guard !email.isEmpty, !pass.isEmpty else {
            statusLabel.textColor = .systemRed
            statusLabel.stringValue = "Email and App Password are required."
            return
        }
        addButton.isEnabled = false
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.stringValue = "Verifying IMAP + SMTP…"

        Task {
            do {
                try await admin.addAccount(
                    email: email,
                    appPassword: pass,
                    displayName: nameField.stringValue,
                    makeDefault: defaultCheck.state == .on,
                    readOnly: readOnlyCheck.state == .on
                )
                onDone()
                reset()
                close()
            } catch {
                statusLabel.textColor = .systemRed
                statusLabel.stringValue = error.localizedDescription
                addButton.isEnabled = true
            }
        }
    }

    private func reset() {
        emailField.stringValue = ""
        passField.stringValue = ""
        nameField.stringValue = ""
        defaultCheck.state = .off
        readOnlyCheck.state = .off
        statusLabel.stringValue = ""
        addButton.isEnabled = true
    }
}

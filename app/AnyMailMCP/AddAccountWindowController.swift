import AppKit

/// Add-account form: email + password (+ provider, name, flags) → POST /admin/accounts.
/// Supports Gmail (default), iCloud, Fastmail, and a Custom IMAP account with its own
/// hosts/ports. Also hosts the "Create an App Password" assistant, which hands the
/// browser work off to the user's own browser or an AI agent rather than automating
/// Google's page itself. The password is posted straight to the local engine (which
/// stores it in the Keychain) — the model never sees it, unlike the MCP add_account tool.
@MainActor
final class AddAccountWindowController: NSWindowController {
    private let admin: AdminClient
    private let onDone: @MainActor () -> Void

    private let emailField = NSTextField()
    private let passField = NSSecureTextField()
    private let nameField = NSTextField()
    private let defaultCheck = NSButton(checkboxWithTitle: "Make default", target: nil, action: nil)
    private let readOnlyCheck = NSButton(checkboxWithTitle: "Read-only", target: nil, action: nil)
    private let providerPopup = NSPopUpButton()
    private let imapHostField = NSTextField()
    private let imapPortField = NSTextField()
    private let smtpHostField = NSTextField()
    private let smtpPortField = NSTextField()
    private let startTlsCheck = NSButton(checkboxWithTitle: "SMTP uses STARTTLS (port 587)", target: nil, action: nil)
    private let imapFields = NSStackView()
    private let statusLabel = NSTextField(labelWithString: "")
    private let addButton = NSButton(title: "Add Account", target: nil, action: nil)

    private static let appPasswordsURL = URL(string: "https://myaccount.google.com/apppasswords")!
    private static let chatgptURL = URL(string: "https://chatgpt.com/")!
    private static let claudeURL = URL(string: "https://claude.ai/")!

    init(admin: AdminClient, onDone: @escaping @MainActor () -> Void) {
        self.admin = admin
        self.onDone = onDone
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 470, height: 520),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "Add Mail Account"
        super.init(window: window)
        window.center()
        buildUI()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) not used") }

    private func buildUI() {
        guard let content = window?.contentView else { return }

        emailField.placeholderString = "you@gmail.com"
        passField.placeholderString = "App Password / IMAP password"
        nameField.placeholderString = "Display name (optional)"
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.lineBreakMode = .byWordWrapping
        statusLabel.maximumNumberOfLines = 4
        statusLabel.preferredMaxLayoutWidth = 420

        addButton.target = self
        addButton.action = #selector(add)
        addButton.keyEquivalent = "\r"

        // Password row with an inline "Paste" button — for a password an agent returned.
        let pasteButton = NSButton(title: "Paste", target: self, action: #selector(pastePassword))
        pasteButton.bezelStyle = .rounded
        pasteButton.setContentHuggingPriority(.required, for: .horizontal)
        passField.widthAnchor.constraint(equalToConstant: 240).isActive = true
        let passRow = NSStackView(views: [passField, pasteButton])
        passRow.orientation = .horizontal
        passRow.spacing = 6

        providerPopup.addItems(withTitles: ["Gmail", "iCloud", "Fastmail", "Custom IMAP"])
        providerPopup.target = self
        providerPopup.action = #selector(providerChanged)
        buildIMAPFields()

        let stack = NSStackView(views: [
            labeled("Email", emailField),
            labeled("Provider", providerPopup),
            imapFields,
            labeled("Password", passRow),
            labeled("Name", nameField),
            defaultCheck,
            readOnlyCheck,
            NSBox.horizontalSeparator(),
            createSection(),
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
        for field in [emailField, nameField] {
            field.widthAnchor.constraint(equalToConstant: 300).isActive = true
        }
        updateIMAPFields()
    }

    // MARK: - Provider / custom IMAP

    private func buildIMAPFields() {
        imapHostField.placeholderString = "imap.host.tld"
        imapPortField.placeholderString = "993"
        smtpHostField.placeholderString = "smtp.host.tld"
        smtpPortField.placeholderString = "465"
        for f in [imapHostField, imapPortField, smtpHostField, smtpPortField] {
            f.widthAnchor.constraint(equalToConstant: 220).isActive = true
        }
        imapFields.orientation = .vertical
        imapFields.alignment = .leading
        imapFields.spacing = 6
        for row in [
            labeled("IMAP host", imapHostField),
            labeled("IMAP port", imapPortField),
            labeled("SMTP host", smtpHostField),
            labeled("SMTP port", smtpPortField),
        ] {
            imapFields.addArrangedSubview(row)
        }
        imapFields.addArrangedSubview(startTlsCheck)
    }

    private func providerId() -> String {
        switch providerPopup.indexOfSelectedItem {
        case 1: return "icloud"
        case 2: return "fastmail"
        case 3: return "imap"
        default: return "gmail"
        }
    }

    @objc private func providerChanged() { updateIMAPFields() }

    private func updateIMAPFields() {
        let isCustom = providerId() == "imap"
        imapFields.isHidden = !isCustom
        window?.setContentSize(NSSize(width: 470, height: isCustom ? 700 : 520))
    }

    /// The "Create an App Password" assistant (Gmail-oriented — Google App Passwords).
    /// Ordered safest-first: your own browser (no new exposure), then a local agent,
    /// then cloud agents behind a blunt warning, since an App Password grants full,
    /// unscoped mailbox access.
    private func createSection() -> NSView {
        let header = NSTextField(labelWithString: "Don't have an App Password (Gmail)? Create one:")
        header.font = .boldSystemFont(ofSize: 12)

        let openPage = button("Open Google's App Passwords page", #selector(openAppPasswordsPage))

        let orLabel = wrapped(
            "…or have an AI agent do it — this copies a ready-to-run task prompt to your clipboard:",
            size: 11, color: .secondaryLabelColor, maxWidth: 420, lines: 2
        )

        let claudeChrome = button("Claude for Chrome — on your Mac", #selector(handoffClaudeChrome))
        claudeChrome.toolTip = "Copies the prompt and opens the page in Chrome. Runs in your own browser and session."

        let chatgpt = button("ChatGPT", #selector(handoffChatGPT))
        let claudeAI = button("Claude.ai", #selector(handoffClaudeAI))
        let cloudRow = NSStackView(views: [chatgpt, claudeAI])
        cloudRow.orientation = .horizontal
        cloudRow.spacing = 6

        let warn = wrapped(
            "⚠ Cloud agents sign into your Google account and create a full-mailbox password on a remote machine — not on your Mac. Prefer “Claude for Chrome” or your own browser.",
            size: 10, color: .systemOrange, maxWidth: 420, lines: 3
        )

        let box = NSStackView(views: [header, openPage, orLabel, claudeChrome, cloudRow, warn])
        box.orientation = .vertical
        box.alignment = .leading
        box.spacing = 6
        return box
    }

    // MARK: - Assistant actions

    @objc private func openAppPasswordsPage() {
        openURL(Self.appPasswordsURL, preferChrome: true)
        setInfo("Opened Google's App Passwords page. Create one named “AnyMail MCP”, then paste the 16-char code above and click Add.")
    }

    @objc private func handoffClaudeChrome() {
        copyToClipboard(taskPrompt())
        openURL(Self.appPasswordsURL, preferChrome: true)
        setInfo("Copied a task prompt. In Chrome, open the Claude side panel and paste it — Claude drives your own browser. Then paste the 16-char result above.")
    }

    @objc private func handoffChatGPT() {
        copyToClipboard(taskPrompt())
        openURL(Self.chatgptURL)
        setInfo("Copied a task prompt & opened ChatGPT. Run it with a computer-using agent, then paste the 16-char password above. (Cloud — see the warning.)")
    }

    @objc private func handoffClaudeAI() {
        copyToClipboard(taskPrompt())
        openURL(Self.claudeURL)
        setInfo("Copied a task prompt & opened Claude. Run it with a computer-using agent, then paste the 16-char password above. (Cloud — see the warning.)")
    }

    @objc private func pastePassword() {
        if let s = NSPasteboard.general.string(forType: .string), !s.isEmpty {
            // Google shows App Passwords as "abcd efgh ijkl mnop"; strip the spaces.
            passField.stringValue = s
                .replacingOccurrences(of: " ", with: "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            setInfo("Pasted the password from your clipboard. Click Add to verify & save.")
        } else {
            setInfo("Clipboard is empty — copy the password first.")
        }
    }

    /// The task handed to an agent (or a reminder for the manual flow). Prefilled
    /// with the email if the user has typed it.
    private func taskPrompt() -> String {
        let email = emailField.stringValue.trimmingCharacters(in: .whitespaces)
        let who = email.isEmpty ? "my Gmail account" : email
        return """
        Create a Gmail App Password for \(who).
        1. Open https://myaccount.google.com/apppasswords
        2. Sign in and finish 2-Step Verification if prompted (2-Step Verification must be ON).
        3. Create a new app password named "AnyMail MCP".
        4. Reply with ONLY the 16-character password (no spaces).
        Keep it secret — it grants full access to this mailbox.
        """
    }

    // MARK: - Helpers

    private func openURL(_ url: URL, preferChrome: Bool = false) {
        if preferChrome,
           let chrome = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.google.Chrome") {
            NSWorkspace.shared.open([url], withApplicationAt: chrome, configuration: NSWorkspace.OpenConfiguration())
        } else {
            NSWorkspace.shared.open(url)
        }
    }

    private func copyToClipboard(_ s: String) {
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(s, forType: .string)
    }

    private func setInfo(_ s: String) {
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.stringValue = s
    }

    private func button(_ title: String, _ action: Selector) -> NSButton {
        let b = NSButton(title: title, target: self, action: action)
        b.bezelStyle = .rounded
        return b
    }

    private func wrapped(_ text: String, size: CGFloat, color: NSColor, maxWidth: CGFloat, lines: Int) -> NSTextField {
        let label = NSTextField(labelWithString: text)
        label.textColor = color
        label.font = .systemFont(ofSize: size)
        label.lineBreakMode = .byWordWrapping
        label.maximumNumberOfLines = lines
        label.preferredMaxLayoutWidth = maxWidth
        return label
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
            statusLabel.stringValue = "Email and password are required."
            return
        }
        let provider = providerId()
        var connection: [String: Any]?
        if provider == "imap" {
            let ih = imapHostField.stringValue.trimmingCharacters(in: .whitespaces)
            let sh = smtpHostField.stringValue.trimmingCharacters(in: .whitespaces)
            guard !ih.isEmpty, !sh.isEmpty else {
                statusLabel.textColor = .systemRed
                statusLabel.stringValue = "Custom IMAP needs an IMAP host and an SMTP host."
                return
            }
            let startTls = startTlsCheck.state == .on
            connection = [
                "imapHost": ih,
                "imapPort": Int(imapPortField.stringValue) ?? 993,
                "smtpHost": sh,
                "smtpPort": Int(smtpPortField.stringValue) ?? (startTls ? 587 : 465),
                "smtpSecure": !startTls,
            ]
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
                    readOnly: readOnlyCheck.state == .on,
                    provider: provider,
                    connection: connection
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
        providerPopup.selectItem(at: 0)
        imapHostField.stringValue = ""
        imapPortField.stringValue = ""
        smtpHostField.stringValue = ""
        smtpPortField.stringValue = ""
        startTlsCheck.state = .off
        statusLabel.stringValue = ""
        addButton.isEnabled = true
        updateIMAPFields()
    }
}

private extension NSBox {
    /// A thin horizontal divider for stacking sections.
    static func horizontalSeparator() -> NSBox {
        let box = NSBox()
        box.boxType = .separator
        box.translatesAutoresizingMaskIntoConstraints = false
        box.widthAnchor.constraint(equalToConstant: 430).isActive = true
        return box
    }
}

import SwiftUI

struct LoginView: View {
    @Environment(\.businessTheme) private var theme
    let session: any AuthSession
    let api: MonytixApi
    let onSignedIn: () -> Void

    @State private var email = ""
    @State private var password = ""
    @State private var creating = false
    @State private var message: String?
    @State private var busy = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BusinessSpace.s12) {
                Text("Monytix")
                    .businessText(.primary, size: BusinessTypeScale.hero, weight: .extraBold)
                    .padding(.top, BusinessSpace.s40)
                Text(creating ? "Create your account" : "Sign in")
                    .businessText(.secondary, size: BusinessTypeScale.bodyLarge)
                field("Email", text: $email)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.emailAddress)
                    .textContentType(.username)
                SecureField("Password", text: $password)
                    .textContentType(creating ? .newPassword : .password)
                    .padding(BusinessSpace.s16)
                    .background(theme.palette.surface, in: RoundedRectangle(cornerRadius: BusinessRadius.action, style: .continuous))
                if let message {
                    Text(message)
                        .businessText(.attention, size: BusinessTypeScale.bodySmall)
                }
                Button(creating ? "Create account" : "Sign in") {
                    Task { await submitEmail() }
                }
                .buttonStyle(GoldButtonStyle(enabled: !busy))
                .disabled(busy)
                Button("Continue with Google") {
                    Task { await submit { await session.signInWithGoogle() } }
                }
                .buttonStyle(GoldButtonStyle(enabled: !busy))
                .disabled(busy)
                Button("Continue with Apple") {
                    Task { await submit { await session.signInWithApple() } }
                }
                .buttonStyle(GoldButtonStyle(enabled: !busy))
                .disabled(busy)
                Button(creating ? "Have an account? Sign in" : "New here? Create account") {
                    creating.toggle()
                }
                .businessText(.accent, size: BusinessTypeScale.body, weight: .semiBold)
                .frame(maxWidth: .infinity)
            }
            .padding(BusinessSpace.s20)
        }
        .businessCanvas()
    }

    private func field(_ title: String, text: Binding<String>) -> some View {
        TextField(title, text: text)
            .padding(BusinessSpace.s16)
            .background(theme.palette.surface, in: RoundedRectangle(cornerRadius: BusinessRadius.action, style: .continuous))
    }

    private func submitEmail() async {
        await submit {
            if creating {
                return await session.createAccount(email: email, password: password)
            }
            return await session.signIn(email: email, password: password)
        }
    }

    private func submit(_ action: () async -> AuthResult) async {
        busy = true
        message = nil
        let result = await action()
        switch result {
        case .success:
            switch await api.confirmSession(token: { force in await session.idToken(forceRefresh: force) }) {
            case .confirmed, .skipped:
                onSignedIn()
            case .rejected(let text):
                message = text
            }
        case .failed(let text):
            message = text
        }
        busy = false
    }
}

private struct GoldButtonStyle: ButtonStyle {
    @Environment(\.businessTheme) private var theme
    let enabled: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.custom("Inter-Bold", size: BusinessTypeScale.body))
            .foregroundStyle(enabled ? BusinessTokens.action.label : theme.palette.disabledLabel)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(
                enabled ? (configuration.isPressed ? BusinessTokens.action.pressed : BusinessTokens.action.default) : theme.palette.disabledFill,
                in: RoundedRectangle(cornerRadius: BusinessRadius.action, style: .continuous)
            )
    }
}

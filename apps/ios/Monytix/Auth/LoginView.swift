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
            VStack(spacing: BusinessSpace.s16) {
                Image("MonytixOMark")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 72, height: 72)
                    .padding(.top, 44)
                    .accessibilityLabel("Monytix")
                Text(creating ? "Create your account" : "Sign in")
                    .businessText(.primary, size: BusinessTypeScale.title, weight: .semiBold)
                    .multilineTextAlignment(.center)
                Text("Your money, right now")
                    .businessText(.secondary, size: BusinessTypeScale.body)
                    .multilineTextAlignment(.center)
                labeledField("Email") {
                    TextField("", text: $email)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                        .textContentType(.username)
                }
                labeledField("Password") {
                    SecureField("", text: $password)
                        .textContentType(creating ? .newPassword : .password)
                }
                if let message {
                    Text(message)
                        .businessText(.attention, size: BusinessTypeScale.bodySmall)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                }
                Button(creating ? "Create account" : "Sign in") {
                    Task { await submitEmail() }
                }
                .buttonStyle(GoldButtonStyle(enabled: !busy))
                .disabled(busy)
                orDivider
                Button("Continue with Google") {
                    Task { await submit { await session.signInWithGoogle() } }
                }
                .buttonStyle(OutlinedButtonStyle(enabled: !busy))
                .disabled(busy)
                Button("Continue with Apple") {
                    Task { await submit { await session.signInWithApple() } }
                }
                .buttonStyle(OutlinedButtonStyle(enabled: !busy))
                .disabled(busy)
                Button(creating ? "Have an account? Sign in" : "New here? Create account") {
                    creating.toggle()
                }
                .buttonStyle(.plain)
                .businessText(.accent, size: BusinessTypeScale.body, weight: .semiBold)
                .frame(maxWidth: .infinity)
                .padding(.top, BusinessSpace.s8)
                .disabled(busy)
            }
            .padding(.horizontal, BusinessSpace.s28)
            .padding(.bottom, BusinessSpace.s28)
        }
        .scrollDismissesKeyboard(.interactively)
        .businessCanvas()
    }

    private var orDivider: some View {
        HStack(spacing: BusinessSpace.s12) {
            Rectangle().businessDivider()
            Text("or")
                .businessText(.secondary, size: BusinessTypeScale.caption)
            Rectangle().businessDivider()
        }
        .padding(.vertical, BusinessSpace.s4)
    }

    private func labeledField<Field: View>(_ title: String, @ViewBuilder field: () -> Field) -> some View {
        VStack(alignment: .leading, spacing: BusinessSpace.s8) {
            Text(title)
                .businessText(.secondary, size: BusinessTypeScale.bodySmall)
            field()
                .font(.custom("Inter-Regular", size: BusinessTypeScale.body))
                .foregroundStyle(theme.palette.textPrimary)
                .padding(.horizontal, BusinessSpace.s16)
                .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                .background(theme.palette.surface, in: RoundedRectangle(cornerRadius: BusinessRadius.action, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: BusinessRadius.action, style: .continuous)
                        .stroke(theme.palette.border, lineWidth: 1)
                )
        }
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
            .overlay(
                RoundedRectangle(cornerRadius: BusinessRadius.action, style: .continuous)
                    .stroke(enabled ? BusinessTokens.action.border : theme.palette.disabledBorder, lineWidth: 1)
            )
    }
}

private struct OutlinedButtonStyle: ButtonStyle {
    @Environment(\.businessTheme) private var theme
    let enabled: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.custom("Inter-SemiBold", size: BusinessTypeScale.body))
            .foregroundStyle(enabled ? theme.palette.textPrimary : theme.palette.disabledLabel)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(
                enabled ? theme.palette.surface : theme.palette.disabledFill,
                in: RoundedRectangle(cornerRadius: BusinessRadius.action, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: BusinessRadius.action, style: .continuous)
                    .stroke(enabled ? theme.palette.border : theme.palette.disabledBorder, lineWidth: 1)
            )
    }
}

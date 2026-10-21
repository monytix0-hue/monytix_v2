import SwiftUI

struct SessionGate: View {
    @State private var session: any AuthSession = AuthSessions.make()
    @State private var api = MonytixApi.fromBundle()
    @State private var signedIn = false

    var body: some View {
        Group {
            if signedIn {
                BusinessShellView(api: api, session: session, onSignOut: signOut)
            } else {
                LoginView(session: session, api: api, onSignedIn: { signedIn = true })
            }
        }
        .onAppear {
            signedIn = session.currentEmail != nil
        }
    }

    private func signOut() {
        Task {
            await api.logout { force in await session.idToken(forceRefresh: force) }
            api.cancelPending()
            api.clearCache()
            await session.signOut()
            signedIn = false
        }
    }
}

import SwiftUI

struct SessionGate: View {
    @State private var session: any AuthSession = AuthSessions.make()
    @State private var api = MonytixApi.fromBundle()
    @State private var signedIn = false

    var body: some View {
        Group {
            if signedIn {
                BusinessKitView(onSignOut: signOut)
            } else {
                LoginView(session: session, api: api, onSignedIn: { signedIn = true })
            }
        }
        .onAppear {
            signedIn = session.currentEmail != nil
        }
    }

    private func signOut() {
        api.cancelPending()
        api.clearCache()
        Task {
            await session.signOut()
            signedIn = false
        }
    }
}

import SwiftUI

struct SessionGate: View {
    @State private var session: any AuthSession = AuthSessions.make()
    @State private var api = MonytixApi.fromBundle()
    @State private var signedIn = false
    @State private var store: UiSessionStore?

    var body: some View {
        Group {
            if signedIn, let store {
                BusinessShellView(api: api, session: session, store: store, onSignOut: signOut)
            } else {
                LoginView(session: session, api: api, onSignedIn: { signedIn = true })
            }
        }
        .onAppear {
            signedIn = session.currentEmail != nil
        }
        .task(id: signedIn) {
            if signedIn {
                let next = store ?? UiSessionStore(api: api) { force in
                    await session.idToken(forceRefresh: force)
                }
                store = next
                await next.prefetch()
            } else {
                store?.clear()
                store = nil
            }
        }
    }

    private func signOut() {
        Task {
            await api.logout { force in await session.idToken(forceRefresh: force) }
            api.cancelPending()
            store?.clear()
            store = nil
            await session.signOut()
            signedIn = false
        }
    }
}

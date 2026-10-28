package com.monytix.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.monytix.app.auth.LoginScreen
import com.monytix.app.auth.MonytixApi
import com.monytix.app.auth.createAuthSession
import com.monytix.app.shell.BusinessShell
import com.monytix.app.shell.UiSessionStore
import com.monytix.app.splash.MonytixSplash
import com.monytix.app.theme.BusinessTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    var onGoogleSignInResult: ((Intent?) -> Unit)? = null

    val googleSignIn = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        onGoogleSignInResult?.invoke(result.data)
        onGoogleSignInResult = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splashScreen = installSplashScreen()
        splashScreen.setOnExitAnimationListener { provider -> provider.remove() }
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            var splashDone by rememberSaveable { mutableStateOf(false) }
            BusinessTheme {
                if (splashDone) {
                    SessionGate()
                } else {
                    MonytixSplash(onFinished = { splashDone = true })
                }
            }
        }
    }
}

@Composable
private fun SessionGate() {
    val session = remember { createAuthSession() }
    val api = remember { MonytixApi(BuildConfig.API_BASE_URL) }
    val scope = rememberCoroutineScope()
    var signedIn by remember { mutableStateOf(session.currentEmail() != null) }
    val store = remember(api) { UiSessionStore(api, session::idToken) }
    LaunchedEffect(signedIn, store) {
        if (signedIn) {
            store.prefetch()
            if (session.currentEmail() == null) {
                store.clear()
                signedIn = false
            }
        } else {
            store.clear()
        }
    }
    if (signedIn) {
        BusinessShell(
            api = api,
            token = session::idToken,
            store = store,
            onSignOut = {
                scope.launch {
                    runCatching { api.logout(session::idToken) }
                    api.cancelPending()
                    store.clear()
                    session.signOut()
                    signedIn = false
                }
            },
        )
    } else {
        LoginScreen(session = session, api = api, onSignedIn = { signedIn = true })
    }
}

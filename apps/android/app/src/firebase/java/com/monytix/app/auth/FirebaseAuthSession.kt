package com.monytix.app.auth

import android.app.Activity
import android.content.Intent
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.GoogleAuthProvider
import com.monytix.app.MainActivity
import com.monytix.app.R
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.tasks.await
import kotlin.coroutines.resume

class FirebaseAuthSession : AuthSession {
    private val auth: FirebaseAuth = FirebaseAuth.getInstance()

    override val isConfigured = true

    override fun currentEmail(): String? = auth.currentUser?.email

    override suspend fun signIn(email: String, password: String): AuthResult {
        return runAuth {
            auth.signInWithEmailAndPassword(email.trim(), password).await()
        }
    }

    override suspend fun createAccount(email: String, password: String): AuthResult {
        return runAuth {
            auth.createUserWithEmailAndPassword(email.trim(), password).await()
        }
    }

    override suspend fun signInWithGoogle(activity: Activity): AuthResult {
        val host = activity as? MainActivity
            ?: return AuthResult.Failed("Google sign-in is unavailable.")
        val options = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestIdToken(activity.getString(R.string.default_web_client_id))
            .requestEmail()
            .build()
        val client = GoogleSignIn.getClient(activity, options)
        val data = suspendCancellableCoroutine<Intent?> { continuation ->
            host.onGoogleSignInResult = { intent ->
                if (continuation.isActive) {
                    continuation.resume(intent)
                }
            }
            continuation.invokeOnCancellation { host.onGoogleSignInResult = null }
            host.startActivityForResult(client.signInIntent, MainActivity.GOOGLE_SIGN_IN)
        }
        val account = runCatching { GoogleSignIn.getSignedInAccountFromIntent(data).await() }.getOrNull()
        val idToken = account?.idToken ?: return AuthResult.Failed("Google sign-in was cancelled.")
        val credential = GoogleAuthProvider.getCredential(idToken, null)
        return runAuth {
            auth.signInWithCredential(credential).await()
        }
    }

    override suspend fun idToken(forceRefresh: Boolean): String? {
        return auth.currentUser?.getIdToken(forceRefresh)?.await()?.token
    }

    override suspend fun signOut() {
        val app = auth.app.applicationContext
        val options = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestIdToken(app.getString(R.string.default_web_client_id))
            .requestEmail()
            .build()
        runCatching { GoogleSignIn.getClient(app, options).signOut().await() }
        auth.signOut()
    }

    private suspend fun runAuth(block: suspend () -> Any?): AuthResult {
        return try {
            block()
            AuthResult.Success
        } catch (_: Exception) {
            AuthResult.Failed("Sign-in failed.")
        }
    }
}

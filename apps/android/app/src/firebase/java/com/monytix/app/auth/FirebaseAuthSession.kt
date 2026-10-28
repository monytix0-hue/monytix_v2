package com.monytix.app.auth

import android.app.Activity
import android.content.Intent
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.auth.api.signin.GoogleSignInStatusCodes
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthInvalidUserException
import com.google.firebase.auth.GoogleAuthProvider
import com.monytix.app.MainActivity
import com.monytix.app.R
import kotlinx.coroutines.CancellationException
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
        runCatching { client.signOut().await() }
        val data = suspendCancellableCoroutine<Intent?> { continuation ->
            host.onGoogleSignInResult = { intent ->
                if (continuation.isActive) {
                    continuation.resume(intent)
                }
            }
            continuation.invokeOnCancellation { host.onGoogleSignInResult = null }
            host.googleSignIn.launch(client.signInIntent)
        }
        return try {
            val account = GoogleSignIn.getSignedInAccountFromIntent(data).await()
            val idToken = account.idToken
                ?: return AuthResult.Failed("Google sign-in did not return an account.")
            val credential = GoogleAuthProvider.getCredential(idToken, null)
            runAuth {
                auth.signInWithCredential(credential).await()
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: ApiException) {
            AuthResult.Failed(googleFailure(error.statusCode))
        } catch (_: Exception) {
            AuthResult.Failed("Google sign-in was cancelled.")
        }
    }

    override suspend fun idToken(forceRefresh: Boolean): String? {
        val user = auth.currentUser ?: return null
        return try {
            user.getIdToken(forceRefresh).await().token
        } catch (error: CancellationException) {
            throw error
        } catch (_: FirebaseAuthInvalidUserException) {
            signOut()
            null
        } catch (_: Exception) {
            null
        }
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

    private fun googleFailure(status: Int): String {
        return when (status) {
            GoogleSignInStatusCodes.SIGN_IN_CANCELLED -> "Google sign-in was cancelled."
            GoogleSignInStatusCodes.SIGN_IN_CURRENTLY_IN_PROGRESS -> "Google sign-in is already in progress."
            CommonStatusCodes.DEVELOPER_ERROR -> "Google sign-in is not set up for this build."
            CommonStatusCodes.NETWORK_ERROR -> "Google sign-in needs a network connection."
            else -> "Google sign-in failed ($status)."
        }
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

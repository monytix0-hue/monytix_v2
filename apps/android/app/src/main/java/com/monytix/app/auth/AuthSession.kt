package com.monytix.app.auth

import android.app.Activity

sealed class AuthResult {
    data object Success : AuthResult()
    data class Failed(val message: String) : AuthResult()
}

interface AuthSession {
    val isConfigured: Boolean
    fun currentEmail(): String?
    suspend fun signIn(email: String, password: String): AuthResult
    suspend fun createAccount(email: String, password: String): AuthResult
    suspend fun signInWithGoogle(activity: Activity): AuthResult
    suspend fun idToken(forceRefresh: Boolean): String?
    suspend fun signOut()
}

private const val missingFirebase = "Firebase is not configured for this build."

class UnconfiguredAuthSession : AuthSession {
    override val isConfigured = false
    override fun currentEmail(): String? = null
    override suspend fun signIn(email: String, password: String) = AuthResult.Failed(missingFirebase)
    override suspend fun createAccount(email: String, password: String) = AuthResult.Failed(missingFirebase)
    override suspend fun signInWithGoogle(activity: Activity) = AuthResult.Failed(missingFirebase)
    override suspend fun idToken(forceRefresh: Boolean): String? = null
    override suspend fun signOut() = Unit
}

fun createAuthSession(): AuthSession {
    if (!com.monytix.app.BuildConfig.FIREBASE_CONFIGURED) {
        return UnconfiguredAuthSession()
    }
    return Class.forName("com.monytix.app.auth.FirebaseAuthSession")
        .getDeclaredConstructor()
        .newInstance() as AuthSession
}

package com.monytix.app.auth

import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import kotlin.coroutines.resume

sealed class ConfirmResult {
    data object Confirmed : ConfirmResult()
    data object Skipped : ConfirmResult()
    data class Rejected(val message: String) : ConfirmResult()
}

class MonytixApi(private val baseUrl: String) {
    private val client = OkHttpClient()
    private val cache = linkedMapOf<String, String>()

    fun cancelPending() {
        client.dispatcher.cancelAll()
    }

    fun clearCache() {
        cache.clear()
    }

    suspend fun confirmSession(token: suspend (Boolean) -> String?): ConfirmResult {
        if (baseUrl.isBlank()) {
            return ConfirmResult.Skipped
        }
        val status = send("GET", "/auth", null, null, token)
        return if (status in 200..299) ConfirmResult.Confirmed else ConfirmResult.Rejected("Sign-in could not be confirmed.")
    }

    suspend fun send(
        method: String,
        path: String,
        jsonBody: String?,
        idempotencyKey: String?,
        token: suspend (Boolean) -> String?,
    ): Int {
        val first = call(method, path, jsonBody, idempotencyKey, token(false))
        val canRetry = method == "GET" || method == "HEAD" || !idempotencyKey.isNullOrBlank()
        if (first != 401 || !canRetry) {
            return first
        }
        return call(method, path, jsonBody, idempotencyKey, token(true))
    }

    private suspend fun call(
        method: String,
        path: String,
        jsonBody: String?,
        idempotencyKey: String?,
        bearer: String?,
    ): Int {
        if (bearer.isNullOrBlank()) {
            return 401
        }
        val builder = Request.Builder()
            .url(baseUrl.trimEnd('/') + path)
            .header("Authorization", "Bearer $bearer")
        if (!idempotencyKey.isNullOrBlank()) {
            builder.header("Idempotency-Key", idempotencyKey)
        }
        when (method) {
            "GET", "HEAD" -> builder.method(method, null)
            else -> {
                val body = (jsonBody ?: "").toRequestBody("application/json".toMediaType())
                builder.method(method, body)
            }
        }
        val request = builder.build()
        return suspendCancellableCoroutine { continuation ->
            val call = client.newCall(request)
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : okhttp3.Callback {
                override fun onFailure(call: okhttp3.Call, e: IOException) {
                    if (continuation.isActive) {
                        continuation.resume(0)
                    }
                }

                override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) {
                    val cached = if (method == "GET" && response.isSuccessful) response.peekBody(64_000).string() else null
                    val code = response.code
                    response.close()
                    if (cached != null) {
                        cache[path] = cached
                    }
                    if (continuation.isActive) {
                        continuation.resume(code)
                    }
                }
            })
        }
    }
}

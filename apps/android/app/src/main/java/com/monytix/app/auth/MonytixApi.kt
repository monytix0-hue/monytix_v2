package com.monytix.app.auth

import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import kotlin.coroutines.resume

data class HttpText(val status: Int, val text: String?)

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

    suspend fun getJson(path: String, token: suspend (Boolean) -> String?): String? {
        if (baseUrl.isBlank()) {
            return null
        }
        val first = fetch(path, token(false))
        val body = if (first.status == 401) fetch(path, token(true)) else first
        return if (body.status in 200..299) body.text else null
    }

    suspend fun submit(
        method: String,
        path: String,
        jsonBody: String?,
        idempotencyKey: String?,
        token: suspend (Boolean) -> String?,
    ): HttpText {
        if (baseUrl.isBlank()) {
            return HttpText(0, null)
        }
        val first = exchange(method, path, jsonBody, idempotencyKey, token(false))
        val canRetry = method == "GET" || method == "HEAD" || !idempotencyKey.isNullOrBlank()
        if (first.status != 401 || !canRetry) {
            return first
        }
        return exchange(method, path, jsonBody, idempotencyKey, token(true))
    }

    suspend fun putSigned(url: String, headers: Map<String, String>, bytes: ByteArray, contentType: String): Int {
        val builder = Request.Builder().url(url)
        headers.forEach { (name, value) -> builder.header(name, value) }
        builder.put(bytes.toRequestBody(contentType.toMediaType()))
        return suspendCancellableCoroutine { continuation ->
            val call = client.newCall(builder.build())
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : okhttp3.Callback {
                override fun onFailure(call: okhttp3.Call, e: IOException) {
                    if (continuation.isActive) continuation.resume(0)
                }

                override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) {
                    val code = response.code
                    response.close()
                    if (continuation.isActive) continuation.resume(code)
                }
            })
        }
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

    private data class Fetched(val status: Int, val text: String?)

    private suspend fun fetch(path: String, bearer: String?): Fetched {
        if (bearer.isNullOrBlank()) {
            return Fetched(401, null)
        }
        val request = Request.Builder()
            .url(baseUrl.trimEnd('/') + path)
            .header("Authorization", "Bearer $bearer")
            .get()
            .build()
        return suspendCancellableCoroutine { continuation ->
            val call = client.newCall(request)
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : okhttp3.Callback {
                override fun onFailure(call: okhttp3.Call, e: IOException) {
                    if (continuation.isActive) {
                        continuation.resume(Fetched(0, null))
                    }
                }

                override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) {
                    val text = if (response.isSuccessful) response.body?.string() else null
                    val status = response.code
                    response.close()
                    if (continuation.isActive) {
                        continuation.resume(Fetched(status, text))
                    }
                }
            })
        }
    }

    private suspend fun exchange(
        method: String,
        path: String,
        jsonBody: String?,
        idempotencyKey: String?,
        bearer: String?,
    ): HttpText {
        if (bearer.isNullOrBlank()) {
            return HttpText(401, null)
        }
        val builder = Request.Builder()
            .url(baseUrl.trimEnd('/') + path)
            .header("Authorization", "Bearer $bearer")
        if (!idempotencyKey.isNullOrBlank()) {
            builder.header("Idempotency-Key", idempotencyKey)
        }
        when (method) {
            "GET", "HEAD" -> builder.method(method, null)
            else -> builder.method(method, (jsonBody ?: "").toRequestBody("application/json".toMediaType()))
        }
        return suspendCancellableCoroutine { continuation ->
            val call = client.newCall(builder.build())
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : okhttp3.Callback {
                override fun onFailure(call: okhttp3.Call, e: IOException) {
                    if (continuation.isActive) continuation.resume(HttpText(0, null))
                }

                override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) {
                    val text = response.body?.string()
                    val status = response.code
                    response.close()
                    if (continuation.isActive) continuation.resume(HttpText(status, text))
                }
            })
        }
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

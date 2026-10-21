"""ECDH Curve25519 and AES-GCM for ReBIT Account Aggregator payloads."""

from __future__ import annotations

import base64
import json
import os

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_IV = b"\x00" * 12


def generate_keypair() -> tuple[bytes, bytes]:
    private = X25519PrivateKey.generate()
    public = private.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    seed = private.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())
    return seed, public


def public_from_private(seed: bytes) -> bytes:
    return X25519PrivateKey.from_private_bytes(seed).public_key().public_bytes(
        serialization.Encoding.Raw,
        serialization.PublicFormat.Raw,
    )


def fresh_nonce() -> bytes:
    return os.urandom(32)


def key_material(public_key: bytes, nonce: bytes) -> dict:
    return {
        "cryptoAlg": "ECDH",
        "curve": "Curve25519",
        "params": "cipher=AES/GCM/NoPadding",
        "DHEKey": {"keyValue": base64.b64encode(public_key).decode("ascii")},
        "Nonce": base64.b64encode(nonce).decode("ascii"),
    }


def issue_key_material(private_key: bytes) -> dict:
    nonce = fresh_nonce()
    return {
        "our_nonce": base64.b64encode(nonce).decode("ascii"),
        "key_material": key_material(public_from_private(private_key), nonce),
    }


def encrypt_for_fiu(plaintext: bytes, ephemeral_private: bytes, ephemeral_nonce: bytes, fiu_public: bytes, fiu_nonce: bytes) -> dict:
    shared = _exchange(ephemeral_private, fiu_public)
    token = AESGCM(_session_key(shared, ephemeral_nonce, fiu_nonce)).encrypt(_IV, plaintext, None)
    return {
        "key_material": key_material(public_from_private(ephemeral_private), ephemeral_nonce),
        "cipher_data": base64.b64encode(token).decode("ascii"),
    }


def decrypt_rebit_payload(encrypted_fi: dict, fiu_private: bytes, fiu_nonce: bytes | None) -> dict:
    material = encrypted_fi.get("key_material") or {}
    their_public = _b64((material.get("DHEKey") or {}).get("keyValue") or "")
    their_nonce = _b64(material["Nonce"]) if material.get("Nonce") else None
    cipher = _b64(encrypted_fi.get("cipher_data") or "")
    shared = _exchange(fiu_private, their_public)
    if fiu_nonce and their_nonce:
        raw = AESGCM(_session_key(shared, fiu_nonce, their_nonce)).decrypt(_IV, cipher, None)
    else:
        raw = AESGCM(shared).decrypt(cipher[:12], cipher[12:], None)
    decoded = json.loads(raw.decode("utf-8"))
    if not isinstance(decoded, dict):
        raise ValueError("fi_payload")
    return decoded


def _exchange(private_seed: bytes, public_key: bytes) -> bytes:
    return X25519PrivateKey.from_private_bytes(private_seed).exchange(X25519PublicKey.from_public_bytes(public_key))


def _session_key(shared: bytes, left: bytes, right: bytes) -> bytes:
    mixed = bytes(a ^ b for a, b in zip(left, right, strict=True))
    return bytes(a ^ b for a, b in zip(shared, mixed, strict=True))


def _b64(value: str) -> bytes:
    return base64.b64decode(value)

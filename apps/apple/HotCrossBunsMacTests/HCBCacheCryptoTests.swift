import XCTest
@testable import HotCrossBunsMac

final class HCBCacheCryptoTests: XCTestCase {
    func testRoundTripRestoresPlaintext() throws {
        let salt = HCBCacheCrypto.randomSalt()
        let key = try HCBCacheCrypto.deriveKey(passphrase: "correct horse battery staple", salt: salt, iterations: 10_000)
        let plaintext = Data("hello encrypted cache".utf8)

        let blob = try HCBCacheCrypto.encrypt(plaintext, key: key, salt: salt, iterations: 10_000)
        let decoded = try HCBCacheCrypto.decrypt(blob, key: key)

        XCTAssertEqual(decoded, plaintext)
    }

    func testWrongPassphraseFailsToDecrypt() throws {
        let salt = HCBCacheCrypto.randomSalt()
        let key = try HCBCacheCrypto.deriveKey(passphrase: "right", salt: salt, iterations: 10_000)
        let wrong = try HCBCacheCrypto.deriveKey(passphrase: "wrong", salt: salt, iterations: 10_000)

        let blob = try HCBCacheCrypto.encrypt(Data("secret".utf8), key: key, salt: salt, iterations: 10_000)
        XCTAssertThrowsError(try HCBCacheCrypto.decrypt(blob, key: wrong), "wrong key must not decrypt")
    }

    func testFreshNoncePerCall() throws {
        // AES-GCM must never reuse a nonce under the same key — every encrypt
        // call gets a fresh one. Two encrypts of the same plaintext under the
        // same key produce distinct ciphertexts.
        let salt = HCBCacheCrypto.randomSalt()
        let key = try HCBCacheCrypto.deriveKey(passphrase: "x", salt: salt, iterations: 10_000)
        let plaintext = Data("hello".utf8)

        let a = try HCBCacheCrypto.encrypt(plaintext, key: key, salt: salt, iterations: 10_000)
        let b = try HCBCacheCrypto.encrypt(plaintext, key: key, salt: salt, iterations: 10_000)

        XCTAssertNotEqual(a.nonce, b.nonce)
        XCTAssertNotEqual(a.ciphertext, b.ciphertext)
    }

    func testSaltLengthMatchesConstant() {
        XCTAssertEqual(HCBCacheCrypto.randomSalt().count, HCBCacheCrypto.saltBytes)
    }

    func testBlobEncodesAsJSON() throws {
        let salt = HCBCacheCrypto.randomSalt()
        let key = try HCBCacheCrypto.deriveKey(passphrase: "x", salt: salt, iterations: 10_000)
        let blob = try HCBCacheCrypto.encrypt(Data("hi".utf8), key: key, salt: salt, iterations: 10_000)
        let data = try JSONEncoder().encode(blob)
        let decoded = try JSONDecoder().decode(HCBCacheCrypto.EncryptedBlob.self, from: data)
        XCTAssertEqual(decoded, blob)
    }

    func testRejectsUnknownVersion() throws {
        let salt = HCBCacheCrypto.randomSalt()
        let key = try HCBCacheCrypto.deriveKey(passphrase: "x", salt: salt, iterations: 10_000)
        let real = try HCBCacheCrypto.encrypt(Data("hi".utf8), key: key, salt: salt, iterations: 10_000)
        let bumped = HCBCacheCrypto.EncryptedBlob(
            version: 999,
            iterations: real.iterations,
            salt: real.salt,
            nonce: real.nonce,
            ciphertext: real.ciphertext
        )
        XCTAssertThrowsError(try HCBCacheCrypto.decrypt(bumped, key: key))
    }
}

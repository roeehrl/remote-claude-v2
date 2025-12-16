package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"io"
	"os"
)

// getEncryptionKey derives a 32-byte key from the environment variable or generates a default
func getEncryptionKey() []byte {
	key := os.Getenv("BRIDGE_ENCRYPTION_KEY")
	if key == "" {
		// Default key for development - in production, set BRIDGE_ENCRYPTION_KEY
		key = "remote-claude-dev-key-change-in-prod"
	}
	// Use SHA-256 to derive a 32-byte key
	hash := sha256.Sum256([]byte(key))
	return hash[:]
}

// Encrypt encrypts plaintext using AES-256-GCM
func Encrypt(plaintext []byte) ([]byte, error) {
	key := getEncryptionKey()

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}

	// Prepend nonce to ciphertext
	ciphertext := gcm.Seal(nonce, nonce, plaintext, nil)
	return ciphertext, nil
}

// Decrypt decrypts ciphertext using AES-256-GCM
func Decrypt(ciphertext []byte) ([]byte, error) {
	key := getEncryptionKey()

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return nil, errors.New("ciphertext too short")
	}

	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, err
	}

	return plaintext, nil
}

// EncryptString is a convenience wrapper for string encryption
func EncryptString(plaintext string) ([]byte, error) {
	return Encrypt([]byte(plaintext))
}

// DecryptString is a convenience wrapper for string decryption
func DecryptString(ciphertext []byte) (string, error) {
	plaintext, err := Decrypt(ciphertext)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

package security

import "testing"

func TestPasswordHash(t *testing.T) {
	hash, err := Hash("test-password")
	if err != nil {
		t.Fatal(err)
	}
	if !Verify("test-password", hash) || Verify("wrong-password", hash) || Verify("test-password", "invalid") {
		t.Fatal("password verification failed")
	}
	hash2, _ := Hash("test-password")
	if hash == hash2 {
		t.Fatal("salt reused")
	}
	token, _ := NewToken()
	if token == "" || len(TokenHash(token)) != 64 {
		t.Fatal("bad token")
	}
}

package domain

type Error struct {
	Status  int
	Code    string
	Message string
	Details any
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }
func Fail(status int, code, message string) *Error {
	return &Error{Status: status, Code: code, Message: message}
}
func Conflict(revision int64, updatedAt string) *Error {
	return &Error{Status: 409, Code: "WORK_VERSION_CONFLICT", Message: "作品已在其他设备更新", Details: map[string]any{"serverRevision": revision, "serverUpdatedAt": updatedAt}}
}

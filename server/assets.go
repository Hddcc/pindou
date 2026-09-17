package assets

import "embed"

//go:embed migrations/*.sql data/mard291.json
var Files embed.FS

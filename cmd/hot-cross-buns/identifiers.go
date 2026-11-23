package main

import "regexp"

var runtimeIdentifier = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$`)

func validIdentifier(value string) bool { return runtimeIdentifier.MatchString(value) }

package modelcatalog

import "github.com/gongahkia/hot-cross-buns/internal/localmodel"

type NativeFutureSelection struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
}
type NativeLocalSelectionReview struct {
	ID               string `json:"id"`
	Generation       string `json:"generation"`
	ModelID          string `json:"model_id"`
	Tag              string `json:"tag"`
	Digest           string `json:"digest"`
	Endpoint         string `json:"endpoint"`
	SettingsRevision string `json:"settings_revision"`
	Notice           string `json:"notice"`
}
type NativeLocalSelectionReceipt = localmodel.SelectionReceipt

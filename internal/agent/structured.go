package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"unicode/utf8"
)

// OutputContract describes host-owned output shape, never executable authority.
// Adapters without native schema support still use the same local validation.
type OutputContract struct {
	MaxAttempts int             `json:"-"`
	MaxBytes    int             `json:"-"`
	Name        string          `json:"name"`
	Schema      json.RawMessage `json:"schema"`
}

var ErrStructuredOutput = errors.New("model output failed its structured contract")

func DecodeStructured[T any](turn Turn, limit int, validate func(T) error) (T, error) {
	var value T
	if limit < 1 || bytes.Equal(bytes.TrimSpace([]byte(turn.Text)), []byte("null")) || len(turn.ToolCalls) > 0 || len(turn.Text) > limit || !utf8.ValidString(turn.Text) {
		return value, ErrStructuredOutput
	}
	dec := json.NewDecoder(bytes.NewBufferString(turn.Text))
	dec.DisallowUnknownFields()
	if dec.Decode(&value) != nil || dec.Decode(new(any)) != io.EOF {
		return value, ErrStructuredOutput
	}
	// Duplicate keys are ambiguous even when encoding/json accepts the last one.
	tokens := json.NewDecoder(bytes.NewBufferString(turn.Text))
	tokens.UseNumber()
	if uniqueJSON(tokens, 0) != nil {
		return value, ErrStructuredOutput
	}
	if validate != nil && validate(value) != nil {
		return value, ErrStructuredOutput
	}
	return value, nil
}
func uniqueJSON(dec *json.Decoder, depth int) error {
	if depth > 64 {
		return ErrStructuredOutput
	}
	token, err := dec.Token()
	if err != nil {
		return err
	}
	delimiter, ok := token.(json.Delim)
	if !ok {
		return nil
	}
	switch delimiter {
	case '{':
		keys := map[string]bool{}
		for dec.More() {
			key, err := dec.Token()
			if err != nil {
				return err
			}
			name, ok := key.(string)
			if !ok || keys[name] {
				return ErrStructuredOutput
			}
			keys[name] = true
			if err := uniqueJSON(dec, depth+1); err != nil {
				return err
			}
		}
	case '[':
		for dec.More() {
			if err := uniqueJSON(dec, depth+1); err != nil {
				return err
			}
		}
	default:
		return ErrStructuredOutput
	}
	_, err = dec.Token()
	return err
}
func CompleteStructured[T any](ctx context.Context, model Model, request TurnRequest, contract OutputContract, validate func(T) error) (T, error) {
	var zero T
	if model == nil || contract.Name == "" || len(contract.Schema) > 64*1024 || !json.Valid(contract.Schema) {
		return zero, ErrStructuredOutput
	}
	attempts := contract.MaxAttempts
	if attempts == 0 {
		attempts = 2
	}
	if attempts < 1 || attempts > 2 {
		return zero, ErrStructuredOutput
	}
	limit := contract.MaxBytes
	if limit == 0 {
		limit = 96 * 1024
	}
	if limit < 1 || limit > 96*1024 {
		return zero, ErrStructuredOutput
	}
	if len(request.Tools) > 0 || request.Computer != nil {
		return zero, ErrStructuredOutput
	}
	request.System += "\nReturn one JSON object, no Markdown or tool calls, matching this host-owned output schema:\n" + string(contract.Schema)
	request.Output = &contract
	request.Messages = cloneMessages(request.Messages)
	for attempt := 0; attempt < attempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return zero, err
		}
		turn, err := model.Complete(ctx, request)
		if err != nil {
			return zero, err
		}
		if err := ctx.Err(); err != nil {
			return zero, err
		}
		if len(turn.ToolCalls) > 0 {
			return zero, ErrStructuredOutput
		}
		if result, err := DecodeStructured(turn, limit, validate); err == nil {
			return result, nil
		}
		request.Messages = append(request.Messages, Message{Role: RoleUser, Content: "The previous response failed the output contract. Return only one JSON object matching the requested schema and original request. Do not call tools or claim authorization. This is the final repair attempt."})
	}
	return zero, ErrStructuredOutput
}

package middleware

import (
	"fmt"
	"net/http"
	"regexp"

	"github.com/go-playground/validator/v10"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	rrule "github.com/teambition/rrule-go"
)

// validate is the package-level validator instance with custom validators registered.
var validate *validator.Validate

// hexColorRe matches CSS hex colors: #RGB or #RRGGBB.
var hexColorRe = regexp.MustCompile(`^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$`)

func init() {
	validate = validator.New()

	// uuid: validates that the string is a valid UUID.
	validate.RegisterValidation("uuid", func(fl validator.FieldLevel) bool {
		s := fl.Field().String()
		if s == "" {
			return true // let "required" handle emptiness
		}
		_, err := uuid.Parse(s)
		return err == nil
	})

	// hexcolor: validates CSS hex color (#RGB or #RRGGBB).
	validate.RegisterValidation("hexcolor", func(fl validator.FieldLevel) bool {
		s := fl.Field().String()
		if s == "" {
			return true
		}
		return hexColorRe.MatchString(s)
	})

	// rrule: validates an iCalendar RRULE string.
	validate.RegisterValidation("rrule", func(fl validator.FieldLevel) bool {
		s := fl.Field().String()
		if s == "" {
			return true
		}
		_, err := rrule.StrToRRule(s)
		return err == nil
	})
}

// BindAndValidate binds the request body to v and validates it using the
// package-level validator with custom validators (uuid, hexcolor, rrule).
// On validation failure it returns a 400 response with field-level error
// details in the standard API error format.
func BindAndValidate(c echo.Context, v interface{}) error {
	if err := c.Bind(v); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": map[string]interface{}{
				"code":    "INVALID_REQUEST",
				"message": "malformed request body",
				"details": []string{err.Error()},
			},
		})
	}

	if err := validate.Struct(v); err != nil {
		validationErrors, ok := err.(validator.ValidationErrors)
		if !ok {
			return c.JSON(http.StatusBadRequest, map[string]interface{}{
				"error": map[string]interface{}{
					"code":    "VALIDATION_ERROR",
					"message": "request validation failed",
					"details": []string{err.Error()},
				},
			})
		}

		details := make([]string, 0, len(validationErrors))
		for _, fe := range validationErrors {
			details = append(details, formatFieldError(fe))
		}

		return c.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": map[string]interface{}{
				"code":    "VALIDATION_ERROR",
				"message": "request validation failed",
				"details": details,
			},
		})
	}

	return nil
}

// formatFieldError produces a human-readable description of a field validation error.
func formatFieldError(fe validator.FieldError) string {
	field := fe.Field()
	switch fe.Tag() {
	case "required":
		return fmt.Sprintf("%s is required", field)
	case "max":
		return fmt.Sprintf("%s must be at most %s characters", field, fe.Param())
	case "min":
		return fmt.Sprintf("%s must be at least %s characters", field, fe.Param())
	case "gte":
		return fmt.Sprintf("%s must be greater than or equal to %s", field, fe.Param())
	case "lte":
		return fmt.Sprintf("%s must be less than or equal to %s", field, fe.Param())
	case "uuid":
		return fmt.Sprintf("%s must be a valid UUID", field)
	case "hexcolor":
		return fmt.Sprintf("%s must be a valid hex color (e.g. #FF0000)", field)
	case "rrule":
		return fmt.Sprintf("%s must be a valid iCalendar RRULE", field)
	default:
		return fmt.Sprintf("%s failed validation: %s", field, fe.Tag())
	}
}

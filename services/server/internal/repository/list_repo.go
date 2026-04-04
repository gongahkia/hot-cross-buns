package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/gongahkia/hot-cross-buns-server/internal/models"
)

// ListRepository handles database operations for lists.
type ListRepository struct{}

// NewListRepository creates a new ListRepository.
func NewListRepository() *ListRepository {
	return &ListRepository{}
}

// CreateList inserts a new list for the given user.
func (r *ListRepository) CreateList(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, list *models.List) error {
	query := `
		INSERT INTO lists (user_id, name, color, sort_order, is_inbox)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, user_id, name, color, sort_order, is_inbox, area_id, created_at, updated_at, deleted_at`

	row := pool.QueryRow(ctx, query, userID, list.Name, list.Color, list.SortOrder, list.IsInbox)
	err := row.Scan(
		&list.ID,
		&list.UserID,
		&list.Name,
		&list.Color,
		&list.SortOrder,
		&list.IsInbox,
		&list.AreaID,
		&list.CreatedAt,
		&list.UpdatedAt,
		&list.DeletedAt,
	)
	if err != nil {
		return fmt.Errorf("create list: %w", err)
	}
	return nil
}

// GetListsByUser returns all non-deleted lists for the given user.
func (r *ListRepository) GetListsByUser(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) ([]models.List, error) {
	query := `
		SELECT id, user_id, name, color, sort_order, is_inbox, area_id, created_at, updated_at, deleted_at
		FROM lists
		WHERE user_id = $1 AND deleted_at IS NULL
		ORDER BY sort_order, created_at`

	rows, err := pool.Query(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("get lists by user: %w", err)
	}
	defer rows.Close()

	var lists []models.List
	for rows.Next() {
		var l models.List
		err := rows.Scan(
			&l.ID,
			&l.UserID,
			&l.Name,
			&l.Color,
			&l.SortOrder,
			&l.IsInbox,
			&l.CreatedAt,
			&l.UpdatedAt,
			&l.DeletedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("scan list row: %w", err)
		}
		lists = append(lists, l)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate list rows: %w", err)
	}

	if lists == nil {
		lists = []models.List{}
	}

	return lists, nil
}

// GetListByID returns a single non-deleted list by ID for the given user.
func (r *ListRepository) GetListByID(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, listID uuid.UUID) (*models.List, error) {
	query := `
		SELECT id, user_id, name, color, sort_order, is_inbox, area_id, created_at, updated_at, deleted_at
		FROM lists
		WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`

	var l models.List
	err := pool.QueryRow(ctx, query, listID, userID).Scan(
		&l.ID,
		&l.UserID,
		&l.Name,
		&l.Color,
		&l.SortOrder,
		&l.IsInbox,
		&l.AreaID,
		&l.CreatedAt,
		&l.UpdatedAt,
		&l.DeletedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get list by id: %w", err)
	}
	return &l, nil
}

// UpdateList partially updates a list. Only non-nil fields are updated.
// Returns the updated list or nil if not found.
func (r *ListRepository) UpdateList(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, listID uuid.UUID, name *string, color *string, sortOrder *int, areaID *uuid.UUID) (*models.List, error) {
	query := `
		UPDATE lists
		SET
			name = COALESCE($1, name),
			color = COALESCE($2, color),
			sort_order = COALESCE($3, sort_order),
			area_id = COALESCE($4, area_id),
			updated_at = now()
		WHERE id = $5 AND user_id = $6 AND deleted_at IS NULL
		RETURNING id, user_id, name, color, sort_order, is_inbox, area_id, created_at, updated_at, deleted_at`

	var l models.List
	err := pool.QueryRow(ctx, query, name, color, sortOrder, areaID, listID, userID).Scan(
		&l.ID,
		&l.UserID,
		&l.Name,
		&l.Color,
		&l.SortOrder,
		&l.IsInbox,
		&l.AreaID,
		&l.CreatedAt,
		&l.UpdatedAt,
		&l.DeletedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("update list: %w", err)
	}
	return &l, nil
}

// DeleteList soft-deletes a list by setting deleted_at. Returns an error if the
// list is the inbox (business rule: inbox cannot be deleted). Returns
// ErrListNotFound if the list does not exist.
func (r *ListRepository) DeleteList(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, listID uuid.UUID) error {
	var isInbox bool
	err := pool.QueryRow(ctx,
		`SELECT is_inbox FROM lists WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
		listID, userID,
	).Scan(&isInbox)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrListNotFound
		}
		return fmt.Errorf("check list before delete: %w", err)
	}

	if isInbox {
		return ErrCannotDeleteInbox
	}

	_, err = pool.Exec(ctx,
		`UPDATE lists SET deleted_at = now(), updated_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
		listID, userID,
	)
	if err != nil {
		return fmt.Errorf("soft delete list: %w", err)
	}
	return nil
}

// Sentinel errors for list operations.
var (
	ErrListNotFound      = errors.New("list not found")
	ErrCannotDeleteInbox = errors.New("cannot delete the Inbox list")
)

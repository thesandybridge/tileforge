use axum::{extract::{Path, State}, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{auth::{parse_user_id, Claims}, error::ApiError, state::{require_db, AppState}};

#[derive(Serialize, sqlx::FromRow, utoipa::ToSchema)]
pub struct ProjectRow {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub tileset_count: i64,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Deserialize)]
pub struct ProjectInput { name: String, description: Option<String> }

fn validate(input: &ProjectInput) -> Result<(), ApiError> {
    let name_len = input.name.trim().chars().count();
    if !(1..=100).contains(&name_len) || input.name.chars().any(char::is_control) {
        return Err(ApiError::InvalidField("project name must be 1-100 printable characters".into()));
    }
    if input.description.as_ref().is_some_and(|value| value.chars().count() > 500 || value.chars().any(char::is_control)) {
        return Err(ApiError::InvalidField("project description must be at most 500 printable characters".into()));
    }
    Ok(())
}

pub async fn list_projects(State(state): State<AppState>, Claims(user): Claims) -> Result<Json<Vec<ProjectRow>>, ApiError> {
    user.require_scope("read")?;
    let db = require_db(&state)?;
    let rows = sqlx::query_as::<_, ProjectRow>(
        "SELECT p.id, p.name, p.description, COUNT(t.id) AS tileset_count, p.created_at, p.updated_at
         FROM projects p LEFT JOIN tile_sets t ON t.project_id = p.id
         WHERE p.user_id = $1 GROUP BY p.id ORDER BY p.name"
    ).bind(parse_user_id(&user)?).fetch_all(&db).await.map_err(|e| ApiError::Db(e.to_string()))?;
    Ok(Json(rows))
}

pub async fn create_project(State(state): State<AppState>, Claims(user): Claims, Json(input): Json<ProjectInput>) -> Result<(StatusCode, Json<ProjectRow>), ApiError> {
    user.require_scope("manage")?;
    validate(&input)?;
    let db = require_db(&state)?;
    let row = sqlx::query_as::<_, ProjectRow>(
        "INSERT INTO projects (user_id, name, description) VALUES ($1, $2, NULLIF($3, ''))
         RETURNING id, name, description, 0::bigint AS tileset_count, created_at, updated_at"
    ).bind(parse_user_id(&user)?).bind(input.name.trim()).bind(input.description.as_deref().map(str::trim))
        .fetch_one(&db).await.map_err(|e| if e.as_database_error().and_then(|d| d.constraint()) == Some("projects_user_id_name_key") { ApiError::Conflict("a project with that name already exists".into()) } else { ApiError::Db(e.to_string()) })?;
    Ok((StatusCode::CREATED, Json(row)))
}

pub async fn update_project(State(state): State<AppState>, Claims(user): Claims, Path(id): Path<Uuid>, Json(input): Json<ProjectInput>) -> Result<Json<ProjectRow>, ApiError> {
    user.require_scope("manage")?;
    validate(&input)?;
    let db = require_db(&state)?;
    let row = sqlx::query_as::<_, ProjectRow>(
        "UPDATE projects SET name = $1, description = NULLIF($2, ''), updated_at = now()
         WHERE id = $3 AND user_id = $4
         RETURNING id, name, description, (SELECT COUNT(*) FROM tile_sets WHERE project_id = projects.id) AS tileset_count, created_at, updated_at"
    ).bind(input.name.trim()).bind(input.description.as_deref().map(str::trim)).bind(id).bind(parse_user_id(&user)?)
        .fetch_optional(&db).await.map_err(|e| ApiError::Db(e.to_string()))?.ok_or(ApiError::NotFound)?;
    Ok(Json(row))
}

pub async fn delete_project(State(state): State<AppState>, Claims(user): Claims, Path(id): Path<Uuid>) -> Result<StatusCode, ApiError> {
    user.require_scope("manage")?;
    let db = require_db(&state)?;
    let result = sqlx::query("DELETE FROM projects WHERE id = $1 AND user_id = $2").bind(id).bind(parse_user_id(&user)?)
        .execute(&db).await.map_err(|e| ApiError::Db(e.to_string()))?;
    if result.rows_affected() == 0 { return Err(ApiError::NotFound); }
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_project_fields() {
        assert!(validate(&ProjectInput { name: "Maps".into(), description: None }).is_ok());
        assert!(validate(&ProjectInput { name: " ".into(), description: None }).is_err());
        assert!(validate(&ProjectInput { name: "Maps".into(), description: Some("x".repeat(501)) }).is_err());
    }
}

"""
Async database client abstractions for the MCP Portal backend.

Provides a lightweight async Supabase (PostgREST) REST client that matches the
minimal chaining API used throughout the codebase:

    await db.table('agents').select('*').eq('user_id', '...').order('created_at', desc=True).execute()

Also includes a NullDatabaseClient fallback that returns empty results in dev
when no Supabase configuration is provided.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

import httpx


@dataclass
class DBResult:
    data: Any


class _BaseTableQuery:
    def __init__(self, table: str):
        self._table = table
        self._op: str = "select"
        self._select: str = "*"
        self._filters: List[Tuple[str, str, Any]] = []  # (col, op, value)
        self._order: Optional[Tuple[str, bool]] = None  # (col, desc)
        self._limit: Optional[int] = None
        self._single: bool = False
        self._body: Any = None
        self._on_conflict: Optional[str] = None

    # Chainable API
    def select(self, columns: str) -> _BaseTableQuery:
        self._op = "select"
        self._select = columns
        return self

    def insert(self, data: Union[Dict[str, Any], List[Dict[str, Any]]]) -> _BaseTableQuery:
        self._op = "insert"
        self._body = data
        return self

    def upsert(self, data: Union[Dict[str, Any], List[Dict[str, Any]]], on_conflict: Optional[str] = None) -> _BaseTableQuery:
        self._op = "upsert"
        self._body = data
        self._on_conflict = on_conflict
        return self

    def update(self, data: Dict[str, Any]) -> _BaseTableQuery:
        self._op = "update"
        self._body = data
        return self

    def delete(self) -> _BaseTableQuery:
        self._op = "delete"
        return self

    def eq(self, column: str, value: Any) -> _BaseTableQuery:
        self._filters.append((column, "eq", value))
        return self

    def in_(self, column: str, values: Sequence[Any]) -> _BaseTableQuery:
        self._filters.append((column, "in", list(values)))
        return self

    def order(self, column: str, desc: bool = False) -> _BaseTableQuery:
        self._order = (column, desc)
        return self

    def limit(self, n: int) -> _BaseTableQuery:
        self._limit = n
        return self

    def single(self) -> _BaseTableQuery:
        self._single = True
        return self

    async def execute(self) -> DBResult:
        raise NotImplementedError


class NullTableQuery(_BaseTableQuery):
    async def execute(self) -> DBResult:
        # Provide safe defaults for development when no DB is present
        if self._op == "insert":
            # Echo back what was inserted
            if isinstance(self._body, list):
                return DBResult(data=self._body)
            return DBResult(data=[self._body])
        return DBResult(data=[])


class NullDatabaseClient:
    def table(self, name: str) -> NullTableQuery:
        return NullTableQuery(name)


class SupabaseTableQuery(_BaseTableQuery):
    def __init__(self, client: "SupabaseRestClient", table: str):
        super().__init__(table)
        self._client = client

    def _build_query_params(self) -> Dict[str, str]:
        params: Dict[str, str] = {}
        if self._op in ("select", "update", "delete"):
            params["select"] = self._select

        # Filters
        for col, op, val in self._filters:
            if op == "eq":
                params[col] = f"eq.{val}"
            elif op == "in":
                # in.(v1,v2,...) per PostgREST
                encoded = ",".join([str(v) for v in (val or [])])
                params[col] = f"in.({encoded})"

        if self._order:
            col, desc = self._order
            params["order"] = f"{col}.{'desc' if desc else 'asc'}"

        if self._limit is not None:
            params["limit"] = str(self._limit)

        if self._on_conflict:
            params["on_conflict"] = self._on_conflict

        return params

    async def execute(self) -> DBResult:
        url = f"{self._client.base_url}/{self._table}"
        headers = self._client.headers.copy()

        params = self._build_query_params()

        # single-object responses
        if self._single:
            headers["Accept"] = "application/vnd.pgrst.object+json"

        # Ensure representation is returned on mutations
        if self._op in ("insert", "update", "delete", "upsert"):
            prefer_parts = ["return=representation"]
            if self._op == "upsert":
                prefer_parts.append("resolution=merge-duplicates")
            headers["Prefer"] = ", ".join(prefer_parts)

        client = self._client.http
        if self._op == "select":
            resp = await client.get(url, params=params, headers=headers)
        elif self._op == "insert":
            resp = await client.post(url, params=params, headers=headers, json=self._body)
        elif self._op == "upsert":
            resp = await client.post(url, params=params, headers=headers, json=self._body)
        elif self._op == "update":
            resp = await client.patch(url, params=params, headers=headers, json=self._body)
        elif self._op == "delete":
            resp = await client.delete(url, params=params, headers=headers)
        else:
            resp = await client.get(url, params=params, headers=headers)

        # Best-effort JSON parse; return [] on failure
        try:
            data = resp.json()
        except Exception:
            data = []

        return DBResult(data=data)


class SupabaseRestClient:
    def __init__(self, base_url: str, api_key: str, auth_token: Optional[str] = None):
        # Normalize URL: ensure we point at /rest/v1
        if not base_url.rstrip("/").endswith("/rest/v1"):
            base_url = base_url.rstrip("/") + "/rest/v1"
        self.base_url = base_url.rstrip("/")
        self.headers = {
            "apikey": api_key,
            "Authorization": f"Bearer {auth_token or api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        self.http = httpx.AsyncClient(timeout=30.0)

    def table(self, name: str) -> SupabaseTableQuery:
        return SupabaseTableQuery(self, name)

    async def aclose(self):
        await self.http.aclose()


def get_database_client(settings) -> Any:
    """Return a database client based on environment settings.

    - If Supabase is configured, return a SupabaseRestClient
    - Otherwise, return a NullDatabaseClient (dev fallback)
    """
    supabase_url = getattr(settings, "supabase_url", None)
    anon_key = getattr(settings, "supabase_anon_key", None)
    service_key = getattr(settings, "supabase_service_role_key", None)

    if supabase_url and (anon_key or service_key):
        token = service_key or anon_key
        return SupabaseRestClient(base_url=supabase_url, api_key=(anon_key or service_key), auth_token=token)

    # Fallback null client (returns empty results)
    return NullDatabaseClient()

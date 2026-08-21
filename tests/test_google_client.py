import json

import pytest

from hcb.errors import GoogleApiError
from hcb.google_client import GoogleApiClient


class Response(dict):
    def __init__(self, status, **headers):
        super().__init__(headers)
        self.status = status


class HttpFailure(Exception):
    def __init__(self, status, reason="bad", **headers):
        self.resp = Response(status, **headers)
        self.content = json.dumps(
            {"error": {"message": "sanitized", "errors": [{"reason": reason}]}}
        ).encode()


class Request:
    def __init__(self, result=None, error=None):
        self.result = result or {}
        self.error = error
        self.headers = {}

    def execute(self):
        if self.error:
            raise self.error
        return self.result


@pytest.mark.parametrize("status", [401, 403, 404, 409, 410, 429, 500, 503])
def test_http_statuses_are_mapped_without_network(status):
    request = Request(error=HttpFailure(status, Retry_After="4"))
    with pytest.raises(GoogleApiError) as raised:
        GoogleApiClient._execute(request)
    assert raised.value.status == status
    assert raised.value.reason == "bad"
    assert str(raised.value) == "sanitized"
    assert raised.value.retryable is (status == 429 or status >= 500)
    assert raised.value.is_conflict is (status in {409, 410, 412})


def test_execute_applies_if_match_and_returns_json():
    request = Request({"id": "remote"})
    assert GoogleApiClient._execute(request, etag='"v1"') == {"id": "remote"}
    assert request.headers["If-Match"] == '"v1"'

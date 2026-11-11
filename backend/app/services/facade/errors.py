"""FacadeError — the single client-facing failure type raised by the facade.

Carries the HTTP status the API layer should answer with, so business rules
never import Flask/HTTP concepts beyond this number.
"""


class FacadeError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status

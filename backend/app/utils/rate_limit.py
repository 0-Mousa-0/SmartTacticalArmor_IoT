"""In-process brute-force protection for the login endpoint.

The API runs as a single gunicorn worker, so an in-memory sliding window is
sufficient; a multi-instance deployment would move this to Redis.
"""
import threading
import time


class LoginRateLimiter:
    def __init__(self, max_attempts: int = 5, window_s: int = 300):
        self.max_attempts = max_attempts
        self.window_s = window_s
        self._failures: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def retry_after(self, key: str) -> int:
        """Seconds until ``key`` may try again (0 = allowed now)."""
        now = time.monotonic()
        with self._lock:
            recent = [t for t in self._failures.get(key, []) if now - t < self.window_s]
            self._failures[key] = recent
            if len(recent) < self.max_attempts:
                return 0
            return int(self.window_s - (now - recent[0])) + 1

    def record_failure(self, key: str) -> None:
        with self._lock:
            self._failures.setdefault(key, []).append(time.monotonic())

    def reset(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)

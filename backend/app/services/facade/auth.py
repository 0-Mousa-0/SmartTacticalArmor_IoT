"""Authentication use cases: login, token verification, password change,
and the optional first-admin bootstrap."""
import jwt
from werkzeug.security import check_password_hash, generate_password_hash

from app.models.base_model import utcnow
from app.models.enums import OperatorRole
from app.models.operator import Operator
from app.services.facade.errors import FacadeError
from app.utils.tokens import decode_access_token, issue_access_token

# Compared against when the email is unknown, so a wrong email and a wrong
# password take the same time (no account enumeration by timing).
_DUMMY_HASH = generate_password_hash("timing-equaliser-not-a-real-password")


class AuthFacadeMixin:
    def login(self, email: str, password: str, client_ip: str = "unknown") -> dict:
        email_key = (email or "").strip().lower()
        limiter_key = f"{email_key}|{client_ip}"
        wait = self.login_limiter.retry_after(limiter_key)
        if wait:
            raise FacadeError(f"Too many failed attempts. Try again in {wait} seconds.", 429)

        operator = self.operators.get_by_email(email_key) if email_key else None
        if operator is None:
            check_password_hash(_DUMMY_HASH, password or "")
            self.login_limiter.record_failure(limiter_key)
            raise FacadeError("Invalid email or password", 401)
        if not operator.check_password(password or ""):
            self.login_limiter.record_failure(limiter_key)
            raise FacadeError("Invalid email or password", 401)
        if not operator.is_active:
            raise FacadeError("This account is disabled", 403)

        self.login_limiter.reset(limiter_key)
        with self.transaction():
            operator.last_login_at = utcnow()
        token, lifetime = issue_access_token(
            operator_id=operator.operator_id,
            role=operator.role,
            name=operator.full_name,
            secret=self._cfg("SECRET_KEY"),
            expires_minutes=self._cfg("JWT_EXPIRES_MINUTES"),
        )
        return {"access_token": token, "token_type": "Bearer", "expires_in": lifetime,
                "operator": operator.to_dict()}

    def authenticate_token(self, token: str) -> Operator:
        try:
            payload = decode_access_token(token, self._cfg("SECRET_KEY"))
        except jwt.ExpiredSignatureError:
            raise FacadeError("Session expired — please sign in again", 401) from None
        except jwt.InvalidTokenError:
            raise FacadeError("Invalid session token", 401) from None
        operator = self.operators.get(payload["sub"])
        if operator is None or not operator.is_active:
            raise FacadeError("Account is not active", 401)
        return operator

    def get_profile(self, operator_id: str) -> dict:
        operator = self.operators.get(operator_id)
        if operator is None:
            raise FacadeError("Operator not found", 404)
        return operator.to_dict()

    def change_password(self, operator_id: str, current_password: str, new_password: str) -> dict:
        with self.transaction():
            operator = self.operators.get(operator_id)
            if operator is None:
                raise FacadeError("Operator not found", 404)
            if not operator.check_password(current_password or ""):
                raise FacadeError("Current password is incorrect", 400)
            operator.set_password(new_password)
        return {"message": "Password changed"}

    def ensure_bootstrap_admin(self) -> bool:
        """Create the first admin from env vars when no admin exists yet."""
        email, password = self._cfg("BOOTSTRAP_ADMIN_EMAIL"), self._cfg("BOOTSTRAP_ADMIN_PASSWORD")
        if not email or not password:
            return False
        with self.transaction():
            if self.operators.count_active_admins() > 0 or self.operators.get_by_email(email):
                return False
            admin = Operator(email=email, full_name=self._cfg("BOOTSTRAP_ADMIN_NAME"), role=OperatorRole.ADMIN.value)
            admin.set_password(password)
            self.operators.add(admin)
        return True

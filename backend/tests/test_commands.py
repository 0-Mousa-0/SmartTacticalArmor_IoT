"""Operations-room commands: publish, correlate response, time out."""
import pytest

from app.services.facade import FacadeError


def test_command_is_published_with_correlation_id(facade, vest, publisher, accounts):
    command = facade.send_command(vest["device_id"], "ping", {}, accounts["operator"]["operator_id"])
    assert command["status"] == "sent"
    device_code, message = publisher.sent[-1]
    assert device_code == "STA-01"
    assert message == {"cmd": "ping", "cid": command["correlation_id"]}


def test_response_with_cid_completes_the_command(facade, vest, publisher, accounts):
    command = facade.send_command(vest["device_id"], "interval", {"sec": 2}, accounts["admin"]["operator_id"])
    result = facade.ingest_command_response("STA-01", {"id": "STA-01", "cmd": "interval", "ok": True,
                                                       "cid": command["correlation_id"]})
    assert result["status"] == "acknowledged"
    assert facade.get_device(vest["device_id"])["telemetry_interval_s"] == 2


def test_response_without_cid_falls_back_to_latest_of_type(facade, vest, publisher):
    facade.send_command(vest["device_id"], "calibrate", {}, None)
    result = facade.ingest_command_response("STA-01", {"id": "STA-01", "cmd": "calibrate", "ok": True})
    assert result["status"] == "acknowledged"


def test_reply_that_beats_the_send_confirmation_is_not_lost(facade, vest):
    """Regression (found in the end-to-end run): with a fast broker the vest
    answered before send_command marked the command 'sent', and the reply was
    dropped. The publisher below answers *during* publish to force the race."""
    from app.services.providers import CommandPublisher

    class InstantReplyPublisher(CommandPublisher):
        def publish_command(self, device_code, message):
            facade.ingest_command_response(device_code, {"id": device_code, "cmd": message["cmd"], "ok": True,
                                                         "info": "pong", "cid": message["cid"]})
            return True

    facade.publisher = InstantReplyPublisher()
    command = facade.send_command(vest["device_id"], "ping", {}, None)
    assert command["status"] == "acknowledged"
    assert command["response_info"] == "pong"
    assert command["sent_at"] is not None


def test_offline_channel_fails_visibly(facade, vest, publisher):
    publisher.succeed = False
    command = facade.send_command(vest["device_id"], "evac", {}, None)
    assert command["status"] == "failed"
    assert "offline" in command["response_info"]


def test_unanswered_command_times_out(facade, vest, publisher):
    from datetime import timedelta

    from app.models.base_model import utcnow
    command = facade.send_command(vest["device_id"], "ping", {}, None)
    facade.run_housekeeping(now=utcnow() + timedelta(seconds=60))
    assert facade.list_commands(vest["device_id"])[0]["status"] == "timeout"
    assert command["command_id"] == facade.list_commands(vest["device_id"])[0]["command_id"]


@pytest.mark.parametrize("command_type,params", [
    ("interval", {"sec": 0}),
    ("interval", {"sec": "fast"}),
    ("silent", {"on": "yes"}),
    ("self_destruct", {}),
])
def test_invalid_commands_are_rejected(facade, vest, publisher, command_type, params):
    with pytest.raises(FacadeError) as error:
        facade.send_command(vest["device_id"], command_type, params, None)
    assert error.value.status == 400
    assert publisher.sent == []

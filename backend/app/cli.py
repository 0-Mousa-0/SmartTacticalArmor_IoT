"""Flask CLI commands (run from backend/ with the venv active):

  flask --app wsgi create-operator you@example.com --name "Mousa" --role admin
  flask --app wsgi register-device STA-01 --name "Vest STA-01"
  flask --app wsgi seed-demo            # 6 wearers in Riyadh, STA-01 real + STA-02..06 simulated
  flask --app wsgi housekeeping         # run the periodic maintenance once

Point DATABASE_URL at Supabase to run them against production data — Render's
free plan has no shell, so this is how the first admin and the fleet are set up.
"""
import click

from app.services.facade import FacadeError, get_facade

# Demo posts from the original Riyadh dashboard (assigned positions, not GPS).
DEMO_UNITS = (
    ("STA-01", "ALPHA-01", "فرد ميداني 01", "وسط الرياض", 24.7136, 46.6753, False),
    ("STA-02", "ALPHA-02", "فرد ميداني 02", "حي العليا", 24.6905, 46.6854, True),
    ("STA-03", "ALPHA-03", "فرد ميداني 03", "حي الملقا", 24.8052, 46.6149, True),
    ("STA-04", "ALPHA-04", "فرد ميداني 04", "حي النرجس", 24.8255, 46.6632, True),
    ("STA-05", "ALPHA-05", "فرد ميداني 05", "حي الروضة", 24.7402, 46.7646, True),
    ("STA-06", "ALPHA-06", "فرد ميداني 06", "حي السفارات", 24.6782, 46.6194, True),
)


def register_cli(app) -> None:
    @app.cli.command("create-operator")
    @click.argument("email")
    @click.option("--name", "full_name", required=True, help="Display name")
    @click.option("--role", type=click.Choice(["admin", "operator", "viewer"]), default="operator",
                  show_default=True)
    @click.password_option(help="At least 8 characters")
    def create_operator(email, full_name, role, password):
        """Create a dashboard account."""
        try:
            operator = get_facade().create_operator(email=email, full_name=full_name, role=role, password=password)
        except (FacadeError, ValueError) as error:
            raise click.ClickException(getattr(error, "message", str(error))) from None
        click.echo(f"Created {operator['role']} {operator['email']}")

    @app.cli.command("register-device")
    @click.argument("device_code")
    @click.option("--name", "display_name", default=None, help="Display name (default: Vest <code>)")
    @click.option("--simulated", is_flag=True, help="Mark as a simulated vest")
    def register_device(device_code, display_name, simulated):
        """Register a vest so its MQTT messages are accepted."""
        try:
            device = get_facade().register_device(
                {"device_code": device_code, "display_name": display_name, "is_simulated": simulated})
        except (FacadeError, ValueError) as error:
            raise click.ClickException(getattr(error, "message", str(error))) from None
        click.echo(f"Registered {device['device_code']} (id {device['device_id']})")

    @app.cli.command("seed-demo")
    @click.option("--with-simulated/--real-only", default=True, show_default=True,
                  help="Also create the simulated vests STA-02..06")
    def seed_demo(with_simulated):
        """Create the demo personnel and vests (idempotent)."""
        facade = get_facade()
        for code, callsign, name, zone, lat, lng, simulated in DEMO_UNITS:
            if simulated and not with_simulated:
                continue
            person = facade.personnel.get_by_callsign(callsign)
            if person is None:
                person_id = facade.create_personnel({
                    "callsign": callsign, "full_name": name, "zone": zone,
                    "unit_name": "Riyadh Response Team", "post_lat": lat, "post_lng": lng,
                })["personnel_id"]
                click.echo(f"+ personnel {callsign}")
            else:
                person_id = person.personnel_id
            if facade.devices.get_by_code(code) is None:
                facade.register_device({"device_code": code, "display_name": f"Vest {code}",
                                        "is_simulated": simulated, "personnel_id": person_id})
                click.echo(f"+ device {code} -> {callsign}{' (simulated)' if simulated else ''}")
        click.echo("Demo data ready.")

    @app.cli.command("housekeeping")
    def housekeeping():
        """Run the periodic maintenance once (timeouts, contact-lost, retention)."""
        click.echo(get_facade().run_housekeeping())

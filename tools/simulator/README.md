# Vest simulator: virtual units for demos and tests

`vest_simulator.py` runs virtual vests next to the real one. Each virtual vest is its own MQTT client and
speaks exactly the [vest protocol](../../docs/05-mqtt-protocol.md): retained status with a Last Will,
telemetry, alert transitions, and command replies with the correlation id. The backend cannot tell them
from hardware. The dashboard labels them **Simulated** only because the fleet registry marks them so.

Use it to:

* show a realistic operations room with six units while only one physical vest exists;
* rehearse a presentation with a scripted scenario;
* test the system end to end without hardware ([tools/e2e](../e2e/README.md)).

## Setup

Requires Python 3.10 or later.

```powershell
cd tools/simulator
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env      # broker address + the sta-simulator account (docs/07-setup-emqx.md)
```

The vests must be registered first. `flask --app wsgi seed-demo` registers STA-02 … STA-06 as simulated
and assigns them wearers.

## Run

```powershell
python vest_simulator.py                         # STA-02..STA-06, interactive console
python vest_simulator.py --demo                  # scripted scenario for a presentation
python vest_simulator.py --demo --demo-speed 2   # the same, twice as fast
python vest_simulator.py --devices STA-02,STA-03 --interval 2
```

| Option | Default | Meaning |
|---|---|---|
| `--host`, `--port`, `--username`, `--password` | from `.env` | Broker connection |
| `--tls` / `--no-tls` | TLS on | Use `--no-tls` only with a local test broker |
| `--devices` | `STA-02,…,STA-06` | Which virtual vests to run |
| `--interval` | `5` | Telemetry period in seconds |
| `--demo` | off | Play the scripted scenario below |
| `--demo-speed` | `1.0` | Compress the scenario timeline |
| `--duration` | `0` (no limit) | Stop after N seconds |
| `--no-console` | off | Do not read commands from the keyboard (for scripts) |

## Console commands

Type a scenario followed by a vest, for example `fall STA-03`:

| Command | What the operations room sees |
|---|---|
| `fall` / `mandown` | Pre-alert, then critical after 10 s unless you type `ok` |
| `ok` | The wearer cancels the pre-alert ("I'm OK") |
| `sos` | SOS critical, top of the priority queue |
| `impact` | Hard-hit warning |
| `heat` / `fire` / `cool` | Vest temperature climbs to 49 °C (heat warning) / 58 °C (critical) / returns to normal. The AI usually flags the rise before the fixed threshold does |
| `anomaly` | Temperature settles 3.6 °C above this wearer's normal, still below the 45 °C threshold, so only the AI flags it |
| `still` / `walk` | Stops moving (no-motion alert after 60 s) / moves normally again |
| `offline` / `online` | Vest drops off the air (Last Will, then contact lost) / comes back |
| `list`, `help`, `quit` | |

Acknowledging an incident on the dashboard reaches the virtual vest as well: its log shows
`ACK from ops room … wearer told help is coming`.

## Demo script (`--demo`)

The first 2½ minutes are quiet, so the AI can learn each wearer's baseline (30 readings at 5 s). Then:

| Time | Event |
|---|---|
| 2:30 | STA-04: abnormal temperature pattern, which only the AI flags |
| 3:30 | STA-03: fall. Nobody answers, so it becomes critical, ready for an operator to acknowledge |
| 4:30 | STA-05: heat exposure |
| 5:30 | STA-02: SOS |
| 6:30 | STA-06 goes off the air: Last Will, then `CONTACT_LOST` |
| 8:20 | STA-06 is back, and the contact-lost incident clears itself |
| 8:40 – 9:00 | Everyone returns to normal |

With `--devices` set, the script uses the vests in the order given.

## Mind the free quota

Five virtual vests at 5 s use about 1.25 GB per month if they run around the clock, more than the EMQX
free tier. Run the simulator for demos and tests, not permanently. Use `--interval 10` or more for long
runs.

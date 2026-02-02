# Random Person Movement Tracker

Generate realistic random person movements along actual roads using OpenStreetMap data.

## Features

- 🗺️ Uses real road networks from OpenStreetMap
- 🚶 Generates paths that follow actual streets and sidewalks
- ⏱️ Creates movements with timestamps based on walking speed
- 📍 Supports both place names and GPS coordinates
- 💾 Exports data to JSON format

## Installation

1. Install the required dependencies:

```bash
pip install -r requirements.txt
```

## Usage

### Basic Usage

Run the example script:

```bash
python random_movement.py
```

### Custom Usage

```python
from random_movement import PersonMovementGenerator

# Option 1: Use a place name
generator = PersonMovementGenerator(place_name="Manhattan, New York, USA")

# Option 2: Use GPS coordinates and radius
generator = PersonMovementGenerator(
    center_point=(37.7749, -122.4194),  # San Francisco
    distance=1000  # 1000 meters radius
)

# Generate a random path
path = generator.generate_random_path(num_waypoints=5)
print(f"Distance: {path['total_distance_meters']} meters")
print(f"Coordinates: {path['coordinates']}")

# Generate movement with timestamps
timed_movement = generator.generate_timed_movement(
    num_waypoints=5,
    speed_mps=1.4  # Walking speed (1.4 m/s ≈ 5 km/h)
)
```

## Parameters

### PersonMovementGenerator

- `place_name`: Name of the location (e.g., "Brooklyn, New York, USA")
- `center_point`: Tuple of (latitude, longitude)
- `distance`: Radius in meters to download street network (default: 1000)

### generate_random_path()

- `num_waypoints`: Number of random waypoints to visit (default: 5)

### generate_timed_movement()

- `num_waypoints`: Number of random waypoints to visit (default: 5)
- `speed_mps`: Speed in meters per second (default: 1.4 m/s)
- `start_time`: Starting datetime (defaults to current time)

## Output Format

The script generates JSON output with the following structure:

```json
{
  "movements": [
    {
      "timestamp": "2025-12-22T10:00:00",
      "latitude": 37.7749,
      "longitude": -122.4194
    }
  ],
  "total_distance_meters": 1234.56,
  "total_duration_seconds": 882.54,
  "average_speed_mps": 1.4
}
```

## Notes

- The first run will download street network data from OpenStreetMap
- Larger areas take longer to download
- Downloaded data is cached by OSMnx for faster subsequent runs
- Walking speed default is 1.4 m/s (approximately 5 km/h)

## Requirements

- Python 3.7+
- osmnx >= 1.9.0
- networkx >= 3.0

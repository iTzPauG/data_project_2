#!/usr/bin/env python3
"""
Random Person Movement Generator
Generates realistic random person movements along actual roads using OpenStreetMap data.
"""

import osmnx as ox
import networkx as nx
import random
from datetime import datetime, timedelta
import json
import time
import sys
import threading
from shapely.geometry import Point


class PersonMovementGenerator:
    """Generates random person movements on real road networks."""
    
    def __init__(self, place_name=None, center_point=None, distance=1000):
        """
        Initialize the movement generator.
        
        Args:
            place_name: Name of the place (e.g., "Manhattan, New York, USA")
            center_point: Tuple of (latitude, longitude) as center
            distance: Distance in meters from center to download street network
        """
        print("Downloading street network...")
        
        if place_name:
            # Download street network by place name
            self.graph = ox.graph_from_place(place_name, network_type='walk')
        elif center_point:
            # Download street network by center point and radius
            self.graph = ox.graph_from_point(
                center_point, 
                dist=distance, 
                network_type='walk'
            )
        else:
            raise ValueError("Either place_name or center_point must be provided")
        
        # Get all nodes in the graph
        self.nodes = list(self.graph.nodes())
        print(f"Loaded {len(self.nodes)} nodes in the street network")
        
        # Note: Building data will be queried on-demand per location due to data size
        self.buildings_cache = {}  # Cache for buildings near each location
    
    def get_random_node(self):
        """Get a random node from the street network."""
        return random.choice(self.nodes)
    
    def get_closest_building(self, lat, lon):
        """Find the closest public building to a given position by querying nearby area."""
        try:
            # Create cache key based on rounded coordinates (200m grid for better caching)
            cache_key = (round(lat, 2), round(lon, 2))
            
            # Check cache first
            if cache_key not in self.buildings_cache:
                # Query buildings within 50m radius (smaller for faster queries)
                try:
                    buildings = ox.features_from_point((lat, lon), tags={'building': True}, dist=50)
                    
                    # Filter for public buildings only (exclude generic/residential types)
                    if len(buildings) > 0:
                        excluded_types = ['yes', 'apartments', 'house', 'residential']
                        public_buildings = buildings[~buildings['building'].isin(excluded_types)]
                        self.buildings_cache[cache_key] = public_buildings if len(public_buildings) > 0 else None
                    else:
                        self.buildings_cache[cache_key] = None
                except Exception:
                    # No buildings found or error - cache empty result
                    self.buildings_cache[cache_key] = None
            
            buildings = self.buildings_cache[cache_key]
            
            if buildings is None or len(buildings) == 0:
                return '', ''
            
            # Reproject to a projected CRS for accurate distance calculations
            # Use UTM zone 30N for Valencia, Spain (EPSG:32630)
            buildings_proj = buildings.to_crs(epsg=32630)
            
            # Create point in the same projected CRS
            from geopandas import GeoSeries
            point_gdf = GeoSeries([Point(lon, lat)], crs='EPSG:4326').to_crs(epsg=32630)
            point_proj = point_gdf.iloc[0]
            
            # Calculate distances to all building centroids in projected coordinates
            centroids = buildings_proj.geometry.centroid
            distances = centroids.distance(point_proj)
            closest_idx = distances.idxmin()
            
            # Get building information from original (unprojected) dataframe
            building = buildings.loc[closest_idx]
            building_type = building.get('building', '')
            building_name = building.get('name', '')
            
            # Handle list values
            if isinstance(building_type, list):
                building_type = building_type[0] if building_type else ''
            if isinstance(building_name, list):
                building_name = building_name[0] if building_name else ''
            
            # Clean strings
            building_type = str(building_type).replace(',', ';').replace('\n', ' ')
            building_name = str(building_name).replace(',', ';').replace('\n', ' ')
            
            return building_name, building_type
        except Exception as e:
            # Silently return empty if error (don't spam logs)
            return '', ''
    
    def get_route_between_nodes(self, start_node, end_node):
        """
        Find the shortest path between two nodes.
        
        Args:
            start_node: Starting node ID
            end_node: Ending node ID
            
        Returns:
            List of nodes representing the path, or None if no path exists
        """
        try:
            route = nx.shortest_path(self.graph, start_node, end_node, weight='length')
            return route
        except nx.NetworkXNoPath:
            return None
    
    def get_coordinates_from_route(self, route):
        """
        Convert a route (list of nodes) to coordinates.
        
        Args:
            route: List of node IDs
            
        Returns:
            List of (latitude, longitude) tuples
        """
        coordinates = []
        for node in route:
            node_data = self.graph.nodes[node]
            coordinates.append((node_data['y'], node_data['x']))
        return coordinates
    
    def generate_random_path(self, num_waypoints=5):
        """
        Generate a random path with multiple waypoints.
        
        Args:
            num_waypoints: Number of waypoints to visit
            
        Returns:
            Dictionary containing path information
        """
        print(f"\nGenerating path with {num_waypoints} waypoints...")
        
        # Select random waypoints
        waypoints = [self.get_random_node() for _ in range(num_waypoints)]
        
        # Build complete path
        full_route = []
        all_coordinates = []
        total_distance = 0
        
        for i in range(len(waypoints) - 1):
            start = waypoints[i]
            end = waypoints[i + 1]
            
            print(f"  Finding route from waypoint {i+1} to {i+2}...")
            route = self.get_route_between_nodes(start, end)
            
            if route is None:
                print(f"  No path found between waypoint {i+1} and {i+2}, selecting new endpoint...")
                # Try to find a reachable node
                attempts = 0
                while route is None and attempts < 10:
                    end = self.get_random_node()
                    route = self.get_route_between_nodes(start, end)
                    attempts += 1
                
                if route is None:
                    print(f"  Could not find path, skipping this segment")
                    continue
                
                waypoints[i + 1] = end
            
            # Calculate distance for this segment
            segment_distance = sum(
                self.graph[route[j]][route[j+1]][0]['length'] 
                for j in range(len(route) - 1)
            )
            total_distance += segment_distance
            
            # Get coordinates
            coords = self.get_coordinates_from_route(route)
            
            # Avoid duplicating the last point of previous segment
            if full_route and full_route[-1] == route[0]:
                route = route[1:]
                coords = coords[1:]
            
            full_route.extend(route)
            all_coordinates.extend(coords)
        
        return {
            'waypoints': waypoints,
            'route': full_route,
            'coordinates': all_coordinates,
            'total_distance_meters': total_distance,
            'num_points': len(all_coordinates)
        }
    
    def generate_timed_movement(self, num_waypoints=5, speed_mps=1.4, 
                                start_time=None):
        """
        Generate a movement path with timestamps.
        
        Args:
            num_waypoints: Number of waypoints to visit
            speed_mps: Speed in meters per second (default 1.4 m/s = ~5 km/h, walking speed)
            start_time: Starting datetime (defaults to now)
            
        Returns:
            List of dictionaries with timestamp, latitude, longitude
        """
        path_data = self.generate_random_path(num_waypoints)
        
        if start_time is None:
            start_time = datetime.now()
        
        coordinates = path_data['coordinates']
        route = path_data['route']
        
        # Generate timestamps based on distance and speed
        timed_points = []
        current_time = start_time
        
        timed_points.append({
            'timestamp': current_time.isoformat(),
            'latitude': coordinates[0][0],
            'longitude': coordinates[0][1]
        })
        
        for i in range(len(route) - 1):
            # Get distance between consecutive nodes
            distance = self.graph[route[i]][route[i+1]][0]['length']
            
            # Calculate time to travel this distance
            travel_time = distance / speed_mps
            current_time += timedelta(seconds=travel_time)
            
            timed_points.append({
                'timestamp': current_time.isoformat(),
                'latitude': coordinates[i+1][0],
                'longitude': coordinates[i+1][1]
            })
        
        return {
            'movements': timed_points,
            'total_distance_meters': path_data['total_distance_meters'],
            'total_duration_seconds': (current_time - start_time).total_seconds(),
            'average_speed_mps': speed_mps
        }
    
    def write_element(self, position, filename, mode='a'):
        """
        Write a single position to a file.
        
        Args:
            position: Dictionary containing 'latitude', 'longitude', 'user_id', 'node_id', 'street_name', 'road_type', 'poi_name', 'poi_type', and optionally 'timestamp'
            filename: Path to the output file
            mode: File mode ('a' for append, 'w' for overwrite)
        """
        with open(filename, mode) as f:
            if 'timestamp' in position:
                line = f"{position['user_id']},{position['timestamp']},{position['latitude']},{position['longitude']},{position.get('node_id', '')},{position.get('street_name', '')},{position.get('road_type', '')},{position.get('poi_name', '')},{position.get('poi_type', '')}\n"
            else:
                line = f"{position['user_id']},{position['latitude']},{position['longitude']},{position.get('node_id', '')},{position.get('street_name', '')},{position.get('road_type', '')},{position.get('poi_name', '')},{position.get('poi_type', '')}\n"
            f.write(line)
    
    def generate_continuous_movement(self, output_file='live_tracking.csv', 
                                     interval_seconds=10, speed_mps=1.4, user_id=None):
        """
        Continuously generate and write movement data to a file.
        Writes one position every interval_seconds until interrupted.
        
        Args:
            output_file: Path to the output CSV file
            interval_seconds: Time between writing positions (default: 10 seconds)
            speed_mps: Speed in meters per second (default: 1.4 m/s walking speed)
            user_id: User ID hash (default: random number between 1-100)
        """
        if user_id is None:
            user_id = random.randint(1, 100)
        
        print(f"Starting continuous tracking...")
        print(f"User ID: {user_id}")
        print(f"Writing to: {output_file}")
        print(f"Interval: {interval_seconds} seconds")
        print(f"Speed: {speed_mps} m/s ({speed_mps * 3.6:.1f} km/h)")
        print("Press Ctrl+C to stop\n")
        
        # Initialize file with header
        with open(output_file, 'w') as f:
            f.write("user_id,timestamp,latitude,longitude,node_id,street_name,road_type,poi_name,poi_type\n")
        
        # Start at a random position
        current_node = self.get_random_node()
        current_time = datetime.now()
        current_position = 0  # Position along current route
        current_route = []
        route_distances = []
        
        points_written = 0
        
        try:
            while True:
                # If we don't have a route or we've reached the end, get a new one
                if not current_route or current_position >= len(current_route) - 1:
                    print(f"Selecting new destination (waypoint {points_written // 5 + 1})...")
                    next_node = self.get_random_node()
                    current_route = self.get_route_between_nodes(current_node, next_node)
                    
                    # If no route found, try another destination
                    attempts = 0
                    while current_route is None and attempts < 10:
                        next_node = self.get_random_node()
                        current_route = self.get_route_between_nodes(current_node, next_node)
                        attempts += 1
                    
                    if current_route is None:
                        print("Warning: Could not find route, staying at current position")
                        current_route = [current_node]
                        route_distances = [0]
                    else:
                        # Calculate distances between consecutive nodes
                        route_distances = []
                        for i in range(len(current_route) - 1):
                            dist = self.graph[current_route[i]][current_route[i+1]][0]['length']
                            route_distances.append(dist)
                    
                    current_position = 0
                    current_node = current_route[0]
                
                # Get current coordinates (interpolate if between nodes)
                node_index = int(current_position)
                fraction = current_position - node_index
                
                if fraction == 0 or node_index >= len(current_route) - 1:
                    # Exactly on a node
                    node_data = self.graph.nodes[current_route[node_index]]
                    current_lat = node_data['y']
                    current_lon = node_data['x']
                else:
                    # Interpolate between two nodes
                    node_data_1 = self.graph.nodes[current_route[node_index]]
                    node_data_2 = self.graph.nodes[current_route[node_index + 1]]
                    lat1, lon1 = node_data_1['y'], node_data_1['x']
                    lat2, lon2 = node_data_2['y'], node_data_2['x']
                    current_lat = lat1 + (lat2 - lat1) * fraction
                    current_lon = lon1 + (lon2 - lon1) * fraction
                
                # Get street name and road type from current edge
                street_name = ""
                road_type = ""
                if node_index < len(current_route) - 1:
                    edge_data = self.graph[current_route[node_index]][current_route[node_index + 1]][0]
                    street_name = edge_data.get('name', '')
                    road_type = edge_data.get('highway', '')
                    # Handle list values
                    if isinstance(street_name, list):
                        street_name = street_name[0] if street_name else ''
                    if isinstance(road_type, list):
                        road_type = road_type[0] if road_type else ''
                    # Clean string for CSV
                    street_name = str(street_name).replace(',', ';').replace('\n', ' ')
                    road_type = str(road_type).replace(',', ';').replace('\n', ' ')
                
                # Get closest building
                poi_name, poi_type = self.get_closest_building(current_lat, current_lon)
                
                # Write current position
                position = {
                    'user_id': user_id,
                    'timestamp': current_time.isoformat(),
                    'latitude': current_lat,
                    'longitude': current_lon,
                    'node_id': current_route[node_index],
                    'street_name': street_name,
                    'road_type': road_type,
                    'poi_name': poi_name,
                    'poi_type': poi_type
                }
                self.write_element(position, output_file)
                points_written += 1
                
                print(f"[{current_time.strftime('%H:%M:%S')}] Point {points_written}: "
                      f"{current_lat:.6f}, {current_lon:.6f}")
                
                # Calculate how far we should move before the next write
                distance_traveled = speed_mps * interval_seconds
                
                # Move along the route
                remaining_distance = distance_traveled
                while remaining_distance > 0 and current_position < len(current_route) - 1:
                    segment_index = int(current_position)
                    if segment_index >= len(route_distances):
                        break
                    
                    segment_distance = route_distances[segment_index]
                    # Account for partial progress in current segment
                    fraction_in_segment = current_position - segment_index
                    remaining_in_segment = segment_distance * (1 - fraction_in_segment)
                    
                    if remaining_distance >= remaining_in_segment:
                        # Move to next node
                        remaining_distance -= remaining_in_segment
                        current_position = segment_index + 1
                    else:
                        # Stay on current segment
                        current_position = current_position + (remaining_distance / segment_distance)
                        remaining_distance = 0
                
                # Update current node and time
                if current_position >= len(current_route) - 1:
                    current_node = current_route[-1]
                    current_position = len(current_route) - 1
                else:
                    current_node = current_route[int(current_position)]
                
                current_time += timedelta(seconds=interval_seconds)
                
                # Wait for the specified interval
                time.sleep(interval_seconds)
        
        except KeyboardInterrupt:
            print(f"\n\n{'='*60}")
            print(f"Tracking stopped by user")
            print(f"Total points written: {points_written}")
            print(f"Output file: {output_file}")
            print(f"Duration: {(datetime.now() - (current_time - timedelta(seconds=interval_seconds * points_written))).total_seconds():.1f} seconds")
            print(f"{'='*60}")
    
    def generate_user_movement_thread(self, user_id, output_file, interval_seconds, speed_mps, lock):
        """
        Generate movement for a single user (to be run in a thread).
        
        Args:
            user_id: User ID for this thread
            output_file: Path to the shared CSV file
            interval_seconds: Time between writing positions
            speed_mps: Speed in meters per second
            lock: Threading lock for file writing
        """
        # Each user starts at a random position
        current_node = self.get_random_node()
        current_time = datetime.now()
        current_position = 0
        current_route = []
        route_distances = []
        points_written = 0
        
        try:
            while True:
                # If we don't have a route or we've reached the end, get a new one
                if not current_route or current_position >= len(current_route) - 1:
                    next_node = self.get_random_node()
                    current_route = self.get_route_between_nodes(current_node, next_node)
                    
                    attempts = 0
                    while current_route is None and attempts < 10:
                        next_node = self.get_random_node()
                        current_route = self.get_route_between_nodes(current_node, next_node)
                        attempts += 1
                    
                    if current_route is None:
                        current_route = [current_node]
                        route_distances = [0]
                    else:
                        route_distances = []
                        for i in range(len(current_route) - 1):
                            dist = self.graph[current_route[i]][current_route[i+1]][0]['length']
                            route_distances.append(dist)
                    
                    current_position = 0
                    current_node = current_route[0]
                
                # Get current coordinates (interpolate if between nodes)
                node_index = int(current_position)
                fraction = current_position - node_index
                
                if fraction == 0 or node_index >= len(current_route) - 1:
                    node_data = self.graph.nodes[current_route[node_index]]
                    current_lat = node_data['y']
                    current_lon = node_data['x']
                else:
                    node_data_1 = self.graph.nodes[current_route[node_index]]
                    node_data_2 = self.graph.nodes[current_route[node_index + 1]]
                    lat1, lon1 = node_data_1['y'], node_data_1['x']
                    lat2, lon2 = node_data_2['y'], node_data_2['x']
                    current_lat = lat1 + (lat2 - lat1) * fraction
                    current_lon = lon1 + (lon2 - lon1) * fraction
                
                # Get street name and road type from current edge
                street_name = ""
                road_type = ""
                if node_index < len(current_route) - 1:
                    edge_data = self.graph[current_route[node_index]][current_route[node_index + 1]][0]
                    street_name = edge_data.get('name', '')
                    road_type = edge_data.get('highway', '')
                    # Handle list values
                    if isinstance(street_name, list):
                        street_name = street_name[0] if street_name else ''
                    if isinstance(road_type, list):
                        road_type = road_type[0] if road_type else ''
                    # Clean string for CSV
                    street_name = str(street_name).replace(',', ';').replace('\n', ' ')
                    road_type = str(road_type).replace(',', ';').replace('\n', ' ')
                
                # Get closest building
                poi_name, poi_type = self.get_closest_building(current_lat, current_lon)
                
                # Write current position (thread-safe)
                position = {
                    'user_id': user_id,
                    'timestamp': current_time.isoformat(),
                    'latitude': current_lat,
                    'longitude': current_lon,
                    'node_id': current_route[node_index],
                    'street_name': street_name,
                    'road_type': road_type,
                    'poi_name': poi_name,
                    'poi_type': poi_type
                }
                
                with lock:
                    self.write_element(position, output_file)
                
                points_written += 1
                
                # Calculate movement for next iteration
                distance_traveled = speed_mps * interval_seconds
                remaining_distance = distance_traveled
                
                while remaining_distance > 0 and current_position < len(current_route) - 1:
                    segment_index = int(current_position)
                    if segment_index >= len(route_distances):
                        break
                    
                    segment_distance = route_distances[segment_index]
                    fraction_in_segment = current_position - segment_index
                    remaining_in_segment = segment_distance * (1 - fraction_in_segment)
                    
                    if remaining_distance >= remaining_in_segment:
                        remaining_distance -= remaining_in_segment
                        current_position = segment_index + 1
                    else:
                        current_position = current_position + (remaining_distance / segment_distance)
                        remaining_distance = 0
                
                if current_position >= len(current_route) - 1:
                    current_node = current_route[-1]
                    current_position = len(current_route) - 1
                else:
                    current_node = current_route[int(current_position)]
                
                current_time += timedelta(seconds=interval_seconds)
                time.sleep(interval_seconds)
        
        except KeyboardInterrupt:
            pass


def main():
    """Example usage of the PersonMovementGenerator."""
    
    # Parse command line arguments
    num_users = 1
    interval_seconds = 2
    speed_mps = 1.4
    
    i = 1
    while i < len(sys.argv):
        if sys.argv[i] in ['--users', '-u']:
            try:
                num_users = int(sys.argv[i + 1])
                if num_users < 1 or num_users > 100:
                    print("Error: Number of users must be between 1 and 100")
                    sys.exit(1)
                i += 2
            except (IndexError, ValueError):
                print("Error: --users requires a number between 1 and 100")
                sys.exit(1)
        elif sys.argv[i] in ['--time', '-t']:
            try:
                interval_seconds = float(sys.argv[i + 1])
                if interval_seconds < 0.1 or interval_seconds > 60:
                    print("Error: Time interval must be between 0.1 and 60 seconds")
                    sys.exit(1)
                i += 2
            except (IndexError, ValueError):
                print("Error: --time requires a number between 0.1 and 60")
                sys.exit(1)
        elif sys.argv[i] in ['--speed', '-s']:
            try:
                speed_mps = float(sys.argv[i + 1])
                if speed_mps < 0.1 or speed_mps > 50:
                    print("Error: Speed must be between 0.1 and 50 m/s")
                    sys.exit(1)
                i += 2
            except (IndexError, ValueError):
                print("Error: --speed requires a number between 0.1 and 50")
                sys.exit(1)
        elif sys.argv[i] in ['--help', '-h']:
            print("Usage: python random_movement.py [options]")
            print("")
            print("Options:")
            print("  --users, -u <number>    Number of concurrent users (1-100, default: 1)")
            print("  --time, -t <seconds>    Time interval between updates (0.1-60, default: 2)")
            print("  --speed, -s <m/s>       Movement speed in meters/second (0.1-50, default: 1.4)")
            print("")
            print("Examples:")
            print("  python random_movement.py --users 5")
            print("  python random_movement.py --users 10 --time 1 --speed 2.0")
            print("  python random_movement.py -u 3 -t 5 -s 1.5")
            sys.exit(0)
        else:
            print(f"Error: Unknown argument '{sys.argv[i]}'")
            print("Use --help for usage information")
            sys.exit(1)
    
    print("=" * 60)
    print("Random Node Coordinate Finder")
    print("=" * 60)
    print("\nInitializing movement generator for Valencia, Spain...")
    generator = PersonMovementGenerator(place_name="Valencia, Spain")
    node = generator.get_random_node()
    node_data = generator.graph.nodes[node]
    lat = node_data['y']
    lon = node_data['x']
    radius = random.randint(20, 50)
    result = {
        "node_id": node,
        "latitude": lat,
        "longitude": lon,
        "radius": radius
    }
    # Write to JSON file
    with open("random_node.json", "w") as f:
        json.dump(result, f, indent=2)
    # Print the JSON
    print(json.dumps(result, indent=2))
    print("\nDone.")
    sys.exit(0)


if __name__ == "__main__":
    main()

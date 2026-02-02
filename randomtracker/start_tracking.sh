#!/bin/bash
# Start Live Movement Tracker
# This script starts the random movement generator in background and the visualization server

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Default values
NUM_USERS=1
TIME_INTERVAL=""
SPEED=""

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --users|-u)
            NUM_USERS="$2"
            if ! [[ "$NUM_USERS" =~ ^[0-9]+$ ]] || [ "$NUM_USERS" -lt 1 ] || [ "$NUM_USERS" -gt 100 ]; then
                echo -e "${RED}Error: Number of users must be between 1 and 100${NC}"
                echo "Usage: ./start_tracking.sh [--users <num>] [--time <seconds>] [--speed <m/s>]"
                exit 1
            fi
            shift 2
            ;;
        --time|-t)
            TIME_INTERVAL="$2"
            shift 2
            ;;
        --speed|-s)
            SPEED="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: ./start_tracking.sh [options]"
            echo ""
            echo "Options:"
            echo "  --users, -u <number>    Number of concurrent users (1-100, default: 1)"
            echo "  --time, -t <seconds>    Time interval between updates (0.1-60, default: 2)"
            echo "  --speed, -s <m/s>       Movement speed in meters/second (0.1-50, default: 1.4)"
            echo ""
            echo "Examples:"
            echo "  ./start_tracking.sh --users 5"
            echo "  ./start_tracking.sh --users 10 --time 1 --speed 2.0"
            echo "  ./start_tracking.sh -u 3 -t 5 -s 1.5"
            exit 0
            ;;
        *)
            echo -e "${RED}Error: Unknown option '$1'${NC}"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

echo "========================================"
echo "  Live Movement Tracker Launcher"
echo "========================================"
echo -e "${BLUE}Number of users: $NUM_USERS${NC}"
if [ ! -z "$TIME_INTERVAL" ]; then
    echo -e "${BLUE}Time interval: $TIME_INTERVAL seconds${NC}"
fi
if [ ! -z "$SPEED" ]; then
    echo -e "${BLUE}Speed: $SPEED m/s${NC}"
fi

# Kill any existing random_movement.py processes
echo -e "${BLUE}Checking for existing tracker processes...${NC}"
EXISTING_PIDS=$(pgrep -f "random_movement.py")
if [ ! -z "$EXISTING_PIDS" ]; then
    echo -e "${RED}Killing existing tracker processes: $EXISTING_PIDS${NC}"
    pkill -f "random_movement.py"
    sleep 1
fi

# Kill any existing visualize_movement.py processes
EXISTING_VIZ_PIDS=$(pgrep -f "visualize_movement.py")
if [ ! -z "$EXISTING_VIZ_PIDS" ]; then
    echo -e "${RED}Killing existing visualization processes: $EXISTING_VIZ_PIDS${NC}"
    pkill -f "visualize_movement.py"
    sleep 1
fi

echo -e "${GREEN}✓ No conflicting processes found${NC}"

# Find Python executable
PYTHON_CMD=""
if command -v python3.10 &> /dev/null; then
    PYTHON_CMD="python3.10"
elif command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
else
    echo -e "${RED}Error: Python not found${NC}"
    exit 1
fi

echo -e "${BLUE}Using Python: $PYTHON_CMD${NC}"

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Check if files exist
if [ ! -f "random_movement.py" ]; then
    echo -e "${RED}Error: random_movement.py not found${NC}"
    exit 1
fi

if [ ! -f "visualize_movement.py" ]; then
    echo -e "${RED}Error: visualize_movement.py not found${NC}"
    exit 1
fi

# Check if required packages are installed
echo -e "${BLUE}Checking dependencies...${NC}"
$PYTHON_CMD -c "import osmnx, networkx, folium, flask" 2>/dev/null
if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Required packages not installed${NC}"
    echo ""
    echo "Please install the required packages first:"
    echo "  pip install -r requirements.txt"
    echo ""
    echo "Or install individually:"
    echo "  pip install osmnx networkx folium flask"
    exit 1
fi
echo -e "${GREEN}✓ All dependencies found${NC}"

# Clean up old tracking data
if [ -f "live_tracking.csv" ]; then
    echo -e "${BLUE}Removing old tracking data...${NC}"
    rm -f live_tracking.csv
fi

# Clean up function
cleanup() {
    echo -e "\n${RED}Shutting down...${NC}"
    if [ ! -z "$MOVEMENT_PID" ]; then
        echo "Stopping movement tracker (PID: $MOVEMENT_PID)"
        kill $MOVEMENT_PID 2>/dev/null
    fi
    if [ ! -z "$VISUALIZE_PID" ]; then
        echo "Stopping web server (PID: $VISUALIZE_PID)"
        kill $VISUALIZE_PID 2>/dev/null
    fi
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

# Start random movement generator in background
echo -e "${GREEN}Starting movement tracker...${NC}"

# Build command with parameters
CMD="$PYTHON_CMD random_movement.py --users $NUM_USERS"
if [ ! -z "$TIME_INTERVAL" ]; then
    CMD="$CMD --time $TIME_INTERVAL"
fi
if [ ! -z "$SPEED" ]; then
    CMD="$CMD --speed $SPEED"
fi

$CMD > movement.log 2>&1 &
MOVEMENT_PID=$!
echo "Movement tracker started (PID: $MOVEMENT_PID)"

# Wait a moment for it to initialize
sleep 2

# Check if movement tracker is still running
if ! ps -p $MOVEMENT_PID > /dev/null; then
    echo -e "${RED}Error: Movement tracker failed to start${NC}"
    echo "Check movement.log for details"
    exit 1
fi

# Wait for live_tracking.csv to be created
echo -e "${BLUE}Waiting for tracking data...${NC}"
echo "(First run may take 30-60 seconds to download map data)"
MAX_WAIT=60
WAITED=0
while [ ! -f "live_tracking.csv" ] && [ $WAITED -lt $MAX_WAIT ]; do
    sleep 2
    WAITED=$((WAITED + 2))
    if [ $((WAITED % 10)) -eq 0 ]; then
        echo "  Still waiting... (${WAITED}s / ${MAX_WAIT}s)"
    fi
done

if [ ! -f "live_tracking.csv" ]; then
    echo -e "${RED}Error: Tracking file not created after ${MAX_WAIT} seconds${NC}"
    echo "The movement tracker might still be downloading map data."
    echo "Check movement.log for details, or try running random_movement.py manually first."
    kill $MOVEMENT_PID 2>/dev/null
    exit 1
fi

echo -e "${GREEN}✓ Tracking data file created${NC}"

# Start visualization server
echo -e "${GREEN}Starting web server...${NC}"
$PYTHON_CMD visualize_movement.py > visualize.log 2>&1 &
VISUALIZE_PID=$!
echo "Web server started (PID: $VISUALIZE_PID)"

# Wait a moment for server to start
sleep 2

# Check if visualization server is still running
if ! ps -p $VISUALIZE_PID > /dev/null; then
    echo -e "${RED}Error: Web server failed to start${NC}"
    echo "Check visualize.log for details"
    kill $MOVEMENT_PID 2>/dev/null
    exit 1
fi

echo ""
echo -e "${GREEN}========================================"
echo "  Both services are running!"
echo -e "========================================${NC}"
echo "Movement tracker: PID $MOVEMENT_PID"
echo "Web server: PID $VISUALIZE_PID"
echo ""
echo "Browser should open automatically at:"
echo "  http://localhost:4444"
echo ""
echo -e "${BLUE}Press Ctrl+C to stop all services${NC}"
echo ""

# Keep script running and wait for both processes
wait $VISUALIZE_PID

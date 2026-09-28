# Home Hub Database Design

## Purpose

The Home Hub database stores meaningful historical information about the Home Hub and connected ShepByte devices.

The database should not be used as a constant dump of live device telemetry.

Live device information should normally be supplied through the device heartbeat and API.

The database is mainly for:

- Device registration
- Device identity
- Important device events
- Alerts
- Historical state changes
- Usage history
- System events
- Update history
- Fault history

---

# Design Principle

## Live Data

Live data should not normally be stored continuously.
*(FYI this based on a future project I have planned but I'm starting with a core Hub, so this is to give you an idea of the application)*


Examples:

- Current temperature
- Current humidity
- Current soil moisture
- Current tank level
- Current CPU temperature
- Current device uptime
- Current battery percentage
- Current Wi-Fi signal
- Current device status

This information should come from the latest device heartbeat.

For example

Planter 1

Temperature: 21.4°C
Humidity: 62%
Soil Moisture: 48%
Water Tank: 73%
Status: Online


This data is used to display live, as I said above it's not to be stored otherwise thats alot of memory used on such a small device.

## Historical Events

This is data that should be stored

Device: Planter 1
Event: Water tank reached low limit
Value: 20%
Timestamp: 2026-09-26 14:32

Here we have an event (Water tank low), this is something that would be stored. Below are some other examples:

- Water tank reached low limit
- Water tank refilled
- Soil moisture reached low threshold
- Pump activated
- Pump fault
- Device disconnected
- Device reconnected
- Device restarted
- Sensor fault detected
- Battery reached low level
- Software update started
- Software update completed
- Software update failed
- Device pairing accepted
- Device pairing rejected

## Devices

Any device connected should also have its information stored within the database.

Device ID: SB-PLANTER-001
Name: Planter 1
Type: Smart Planter
Software Version: 0.1.0
Date Added: 2026-09-28
Enabled: True

## Device Events

Again events are stored, but also different catagories.

Device: Planter 1
Event Type: tank_low
Message: Water tank reached low limit
Value: 20
Severity: warning
Timestamp: 2026-09-26 14:32

info
Device successfully updated.

warning
Water tank reached 20%.

critical
Pump controller stopped responding.

## Update History

As you can update through the homehub, Devices update history will be stored as well.

Device: Planter 1
Previous Version: 0.1.0
New Version: 0.1.1
Status: successful
Timestamp: 2026-09-28 19:14

## Alerts

Based on the Device events, these can be used to create an alerts/alarms page. These events have to then be acknowledged before the device can restart.

Device: Planter 1
Alert: Water tank low
Severity: warning
Created: 2026-09-28 08:42
Acknowledged: False

This would appear on the Homehub main page.

Errors / Alerts

2 Active

## Heartbeats

This how the device feedbacks data.

{
  "device_id": "SB-PLANTER-001",
  "status": "online",
  "software_version": "0.1.0",
  "uptime": 84621,
  "telemetry": {
    "temperature": 21.4,
    "humidity": 62,
    "soil_moisture": 48,
    "water_tank": 73
  }
}

Should it contain something meaningful to be stored, depending what the user sets. Homehub will create and even around this

For example "soil_moisture" low limit could be 50. Of which case an event and alert would be made by the homehub.
#  ShepByte Home Hub - Backend & API

##  Status

  Design Phase - Nothing implemented or created.

##  Purpose

The Home Hub backend provides the communication layer between the Home Hub and compatible devices.
*(Most Probably my other devices so we will call them ShepByte devices)*

Home Hub is designed primarily as a monitoring and management system rather than a controller.
Rather than have one hub controlling everything, each device should be unique for it's Job. This is just to keep all data, messages, communication and system info in one place.

##  Core Principle

**Devices have there own tasks/jobs**

They're responsible for their own primary function.
Home hub offers:

  - Device discovery
  - Secure Pairing
  - Device monitoring
  - Telemetry collection
  - Configuration
  - Software/Firmware management
  - Error and health reporting
  - Manual override if and when required.

##  Device Discovery

When a new device boots, it's local Agent searches the network for an authorised Home Hub.

A newly discovered device is not automatically trusted.

It must first enter a pairing process and be approved by the user.

Once approved, the device becomes part of the Home Hub ecosystem and appears within the Devices Node.

## Agent

Each compatible device runs a lightweight Agent.

The Agent is responsible for communication between the device and Home Hub.

It can report information including:

  - Device identity
  - Device type
  - Capabilities
  - Software version
  - Online status
  - Health information
  - Telemetry
  - Errors

## Commands & Device Control

Home Hub shouldn't normally intervene in to a devices function.

Commands from the Home Hub are primarily intended for:

- User-requested actions
- Configuration changes
- Maintenance
- Diagnostics
- Manual overrides

This ensures devices remain functional even when Home Hub is
offline.

## Security

A device should only trust one authorised Home Hub.

Another Home Hub appearing on the network must not automatically
gain control of existing devices.

Changing the trusted Home Hub will require an explicit
re-pairing or ownership-transfer process.

## Updates

Home Hub can identify the software version running on connected
devices.

When an approved update is available, Home Hub can distribute the
update to the appropriate device.

The device remains responsible for safely applying the update and
reporting the result back to Home Hub.

## Design Goals

- Local-first
- Offline capable
- Secure by default
- Device autonomous
- Expandable
- Hardware independent where practical
- Simple device integration through the Agent protocol

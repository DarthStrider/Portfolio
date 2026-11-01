# Camera Status Monitor

**Stack:** WPF, MVVM, C#  
**Effort:** ~1.5 days  
**Status:** Not started

A desktop dashboard listing fake cameras and doors with live status.

## Features

- [ ] `ListView` of devices (name, type, location, status), coloured via a converter: green Online, grey Offline, red Alarm
- [ ] Background `DeviceSimulator` randomly flips statuses every few seconds; UI updates through the Dispatcher
- [ ] Filter box and "Acknowledge alarm" button bound to an `ICommand`
- [ ] Zero code-behind except `InitializeComponent()`

## Talking point

"I kept the view dumb so the same ViewModel could be unit-tested or reused in another plugin."

## How to run

_To come._

## Design decisions

_To come._

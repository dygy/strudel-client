import React, { useState } from 'react';
import { SelectInput } from './SelectInput';
import { getAudioDevices } from '@strudel/webaudio';

const initdevices = new Map<string, any>();

interface AudioDeviceSelectorProps {
  audioDeviceName: string;
  onChange: (deviceName: string) => void;
  isDisabled: boolean;
}

// Allows the user to select an audio interface for Strudel to play through
export function AudioDeviceSelector({ audioDeviceName, onChange, isDisabled }: AudioDeviceSelectorProps) {
  const [devices, setDevices] = useState(initdevices);
  const devicesInitialized = devices.size > 0;

  const onClick = () => {
    if (devicesInitialized) {
      return;
    }
    getAudioDevices().then((devices: Map<string, any>) => {
      setDevices(devices);
    });
  };
  
  const onDeviceChange = (deviceName: string) => {
    if (!devicesInitialized) {
      return;
    }
    onChange(deviceName);
  };
  
  const options = new Map<string, string>();
  Array.from(devices.keys()).forEach((deviceName) => {
    options.set(deviceName, deviceName);
  });
  
  return (
    <SelectInput
      isDisabled={isDisabled}
      options={options}
      onClick={onClick}
      value={audioDeviceName}
      onChange={onDeviceChange}
    />
  );
}
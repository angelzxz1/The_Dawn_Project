//! The audio devices the studio can play through: each driver type on this
//! system (Core Audio; WASAPI and, when built with it, ASIO; ALSA...) and
//! its output devices, with the sample rates and buffer sizes they take,
//! and the inputs it can record from, with their channels.

use cpal::traits::{DeviceTrait, HostTrait};
use cpal::{SupportedBufferSize, SupportedStreamConfigRange};
use serde::Serialize;

/// Sample rates offered when a device takes a range.
const COMMON_RATES: [u32; 6] = [44_100, 48_000, 88_200, 96_000, 176_400, 192_000];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    /// What `audio_open` takes ("wasapi:…", "asio:…").
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub sample_rates: Vec<u32>,
    /// The buffer sizes (frames) it allows, when it says.
    pub min_buffer: Option<u32>,
    pub max_buffer: Option<u32>,
    pub default_sample_rate: Option<u32>,
    /// How many channels it has (an input's, as it opens).
    pub channels: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverInfo {
    /// cpal's name for it ("ASIO", "WASAPI", "CoreAudio", "ALSA").
    pub id: String,
    pub name: String,
    pub devices: Vec<DeviceInfo>,
    pub inputs: Vec<DeviceInfo>,
}

fn rates(configs: &[SupportedStreamConfigRange]) -> Vec<u32> {
    let mut out: Vec<u32> = COMMON_RATES
        .into_iter()
        .filter(|r| {
            configs
                .iter()
                .any(|c| c.min_sample_rate() <= *r && *r <= c.max_sample_rate())
        })
        .collect();
    // A device with only odd rates still offers them.
    if out.is_empty() {
        out = configs.iter().map(|c| c.max_sample_rate()).collect();
    }
    out.sort_unstable();
    out.dedup();
    out
}

fn buffers(configs: &[SupportedStreamConfigRange]) -> (Option<u32>, Option<u32>) {
    let ranges: Vec<(u32, u32)> = configs
        .iter()
        .filter_map(|c| match c.buffer_size() {
            SupportedBufferSize::Range { min, max } => Some((*min, *max)),
            SupportedBufferSize::Unknown => None,
        })
        .collect();
    if ranges.is_empty() {
        return (None, None);
    }
    (
        ranges.iter().map(|r| r.0).min(),
        ranges.iter().map(|r| r.1).max(),
    )
}

/// A device as the studio lists it, for output or input; none if it can't
/// be asked or has nothing that way.
fn describe(
    device: &cpal::Device,
    default_id: Option<&cpal::DeviceId>,
    input: bool,
) -> Option<DeviceInfo> {
    let id = device.id().ok()?;
    let name = device
        .description()
        .ok()
        .map_or_else(|| device.to_string(), |d| d.name().to_owned());
    let configs: Vec<_> = if input {
        device.supported_input_configs().ok()?.collect()
    } else {
        device.supported_output_configs().ok()?.collect()
    };
    if configs.is_empty() {
        return None;
    }
    let default = if input {
        device.default_input_config().ok()
    } else {
        device.default_output_config().ok()
    };
    let (min_buffer, max_buffer) = buffers(&configs);
    Some(DeviceInfo {
        is_default: default_id == Some(&id),
        id: id.to_string(),
        name,
        sample_rates: rates(&configs),
        min_buffer,
        max_buffer,
        default_sample_rate: default
            .as_ref()
            .map(cpal::SupportedStreamConfig::sample_rate),
        channels: default.map_or(0, |c| c.channels()),
    })
}

/// Every driver type, its output devices and its inputs. A device that
/// can't be asked (unplugged as it's listed, busy) is left out.
pub fn list() -> Vec<DriverInfo> {
    cpal::available_hosts()
        .into_iter()
        .filter_map(|host_id| {
            let host = cpal::host_from_id(host_id).ok()?;
            let default_out = host.default_output_device().and_then(|d| d.id().ok());
            let default_in = host.default_input_device().and_then(|d| d.id().ok());
            let devices = host
                .output_devices()
                .ok()?
                .filter_map(|d| describe(&d, default_out.as_ref(), false))
                .collect();
            let inputs = host
                .input_devices()
                .map(|all| {
                    all.filter_map(|d| describe(&d, default_in.as_ref(), true))
                        .collect()
                })
                .unwrap_or_default();
            Some(DriverInfo {
                id: format!("{host_id:?}"),
                name: host_id.name().to_owned(),
                devices,
                inputs,
            })
        })
        .collect()
}

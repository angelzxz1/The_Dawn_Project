//! The CLAP side: an entry whose factory has the gain and the tone.

use std::ffi::CStr;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};

use clack_extensions::state::{PluginState, PluginStateImpl};
use clack_plugin::entry::prelude::*;
use clack_plugin::plugin::features::{AUDIO_EFFECT, INSTRUMENT, STEREO, SYNTHESIZER};
use clack_plugin::prelude::*;
use clack_plugin::stream::{InputStream, OutputStream};

use crate::{GAIN_NAME, TONE_NAME, VENDOR, VERSION};

pub struct Gain;

impl Plugin for Gain {
    type AudioProcessor<'a> = GainProcessor<'a>;
    type Shared<'a> = GainShared;
    type MainThread<'a> = GainMain<'a>;

    fn declare_extensions(builder: &mut PluginExtensions<Self>, _shared: Option<&GainShared>) {
        builder.register::<PluginState>();
    }
}

/// Its level (f32 bits): a half, until a saved state says otherwise.
pub struct GainShared {
    level: AtomicU32,
}

impl PluginShared<'_> for GainShared {}

impl GainShared {
    fn level(&self) -> f32 {
        f32::from_bits(self.level.load(Ordering::Relaxed))
    }
}

pub struct GainMain<'a> {
    shared: &'a GainShared,
}

impl<'a> PluginMainThread<'a, GainShared> for GainMain<'a> {}

/// Its state is its level, as four bytes.
impl PluginStateImpl for GainMain<'_> {
    fn save(&self, output: &mut OutputStream) -> Result<(), PluginError> {
        output.write_all(&self.shared.level().to_le_bytes())?;
        Ok(())
    }

    fn load(&self, input: &mut InputStream) -> Result<(), PluginError> {
        let mut bytes = [0u8; 4];
        input.read_exact(&mut bytes)?;
        self.shared
            .level
            .store(f32::from_le_bytes(bytes).to_bits(), Ordering::Relaxed);
        Ok(())
    }
}

/// Scales what goes through it by its level.
pub struct GainProcessor<'a> {
    shared: &'a GainShared,
}

impl<'a> PluginAudioProcessor<'a, GainShared, GainMain<'a>> for GainProcessor<'a> {
    fn activate(
        _host: HostAudioProcessorHandle<'a>,
        _main_thread: &GainMain<'a>,
        shared: &'a GainShared,
        _config: PluginAudioConfiguration,
    ) -> Result<Self, PluginError> {
        Ok(Self { shared })
    }

    fn process(
        &mut self,
        _process: Process,
        mut audio: Audio,
        _events: Events,
    ) -> Result<ProcessStatus, PluginError> {
        let level = self.shared.level();
        for mut port in &mut audio {
            let Some(channels) = port.channels()?.into_f32() else {
                continue;
            };
            for pair in channels {
                match pair {
                    ChannelPair::InputOnly(_) => {}
                    ChannelPair::OutputOnly(out) => out.fill(0.0),
                    ChannelPair::InputOutput(input, out) => {
                        for (i, o) in input.iter().zip(out) {
                            *o = i * level;
                        }
                    }
                    ChannelPair::InPlace(buf) => buf.iter_mut().for_each(|s| *s *= level),
                }
            }
        }
        Ok(ProcessStatus::Continue)
    }
}

pub struct Tone;

impl Plugin for Tone {
    type AudioProcessor<'a> = ToneProcessor;
    type Shared<'a> = ();
    type MainThread<'a> = ();
}

/// Silent, for now: it's here to be found as an instrument.
pub struct ToneProcessor;

impl<'a> PluginAudioProcessor<'a, (), ()> for ToneProcessor {
    fn activate(
        _host: HostAudioProcessorHandle<'a>,
        _main_thread: &(),
        _shared: &'a (),
        _config: PluginAudioConfiguration,
    ) -> Result<Self, PluginError> {
        Ok(Self)
    }

    fn process(
        &mut self,
        _process: Process,
        mut audio: Audio,
        _events: Events,
    ) -> Result<ProcessStatus, PluginError> {
        for mut port in &mut audio {
            if let Some(channels) = port.channels()?.into_f32() {
                for pair in channels {
                    if let ChannelPair::OutputOnly(out) | ChannelPair::InPlace(out) = pair {
                        out.fill(0.0);
                    }
                }
            }
        }
        Ok(ProcessStatus::Sleep)
    }
}

pub struct TestEntry {
    factory: PluginFactoryWrapper<TestFactory>,
}

impl Entry for TestEntry {
    fn new(bundle_path: Option<&CStr>) -> Result<Self, EntryLoadError> {
        let path = bundle_path.map(|p| p.to_string_lossy()).unwrap_or_default();
        if path.contains("Crashes") {
            std::process::abort();
        }
        if path.contains("Hangs") {
            std::thread::sleep(std::time::Duration::from_secs(120));
        }
        Ok(Self {
            factory: PluginFactoryWrapper::new(TestFactory {
                gain: PluginDescriptor::new("com.dawn-project.test.gain", GAIN_NAME)
                    .with_vendor(VENDOR)
                    .with_version(VERSION)
                    .with_features([AUDIO_EFFECT, STEREO]),
                tone: PluginDescriptor::new("com.dawn-project.test.tone", TONE_NAME)
                    .with_vendor(VENDOR)
                    .with_version(VERSION)
                    .with_features([INSTRUMENT, SYNTHESIZER, STEREO]),
            }),
        })
    }

    fn declare_factories<'a>(&'a self, builder: &mut EntryFactories<'a>) {
        builder.register_factory(&self.factory);
    }
}

pub struct TestFactory {
    gain: PluginDescriptor,
    tone: PluginDescriptor,
}

impl PluginFactoryImpl for TestFactory {
    fn plugin_count(&self) -> u32 {
        2
    }

    fn plugin_descriptor(&self, index: u32) -> Option<&PluginDescriptor> {
        match index {
            0 => Some(&self.gain),
            1 => Some(&self.tone),
            _ => None,
        }
    }

    fn create_plugin<'a>(
        &'a self,
        host_info: HostInfo<'a>,
        plugin_id: &CStr,
    ) -> Option<PluginInstance<'a>> {
        if Some(plugin_id) == self.gain.id() {
            Some(PluginInstance::new::<Gain>(
                host_info,
                &self.gain,
                |_| {
                    Ok(GainShared {
                        level: AtomicU32::new(0.5f32.to_bits()),
                    })
                },
                |_, shared| Ok(GainMain { shared }),
            ))
        } else if Some(plugin_id) == self.tone.id() {
            Some(PluginInstance::new::<Tone>(
                host_info,
                &self.tone,
                |_| Ok(()),
                |_, _| Ok(()),
            ))
        } else {
            None
        }
    }
}

clack_export_entry!(TestEntry);

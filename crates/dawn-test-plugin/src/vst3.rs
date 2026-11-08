//! The VST3 side: a factory (IPluginFactory2) with the gain's processor
//! and controller and the tone's processor, and the module's entry and
//! exit functions for each system. The gain runs: its processor scales
//! what goes through it by its level (a half, until its state or its one
//! parameter says otherwise), and its controller, a separate object as
//! many plugins' are, has that parameter. The tone plays: it has no audio
//! input, an event bus for its notes, and plays a constant level while a
//! key is down (the velocity it was pressed with, from its note's frame).
//! The factory is only handed out once the
//! module's entry function has been called, as the SDK's hosting rules say
//! it must be (on Windows that function is optional).

#![allow(non_snake_case)]

use std::cell::Cell;
use std::ffi::{c_char, c_void};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use vst3::Steinberg::Vst::*;
use vst3::Steinberg::*;
use vst3::{Class, ComRef, ComWrapper, uid};

use crate::{GAIN_NAME, TONE_NAME, VENDOR, VERSION};

static ENTERED: AtomicBool = AtomicBool::new(cfg!(target_os = "windows"));

const GAIN_CID: TUID = uid(0x44415744, 0x4E544553, 0x54474149, 0x4E000001);
const GAIN_CONTROLLER_CID: TUID = uid(0x44415744, 0x4E544553, 0x54474149, 0x4E000002);
const TONE_CID: TUID = uid(0x44415744, 0x4E544553, 0x54544F4E, 0x45000001);

fn copy(text: &str, to: &mut [c_char]) {
    let n = text.len().min(to.len() - 1);
    for (dst, src) in to.iter_mut().zip(&text.as_bytes()[..n]) {
        *dst = *src as c_char;
    }
    to[n] = 0;
}

struct Factory;

impl Class for Factory {
    type Interfaces = (IPluginFactory2,);
}

/// The factory's classes: (id, category, name, sub-categories).
const CLASSES: [(TUID, &str, &str, &str); 3] = [
    (GAIN_CID, "Audio Module Class", GAIN_NAME, "Fx"),
    (
        GAIN_CONTROLLER_CID,
        "Component Controller Class",
        GAIN_NAME,
        "",
    ),
    (
        TONE_CID,
        "Audio Module Class",
        TONE_NAME,
        "Instrument|Synth",
    ),
];

impl IPluginFactoryTrait for Factory {
    unsafe fn getFactoryInfo(&self, info: *mut PFactoryInfo) -> tresult {
        let info = unsafe { &mut *info };
        copy(VENDOR, &mut info.vendor);
        copy("", &mut info.url);
        copy("", &mut info.email);
        info.flags = PFactoryInfo_::FactoryFlags_::kUnicode as int32;
        kResultOk
    }

    unsafe fn countClasses(&self) -> int32 {
        CLASSES.len() as int32
    }

    unsafe fn getClassInfo(&self, index: int32, info: *mut PClassInfo) -> tresult {
        let Some((cid, category, name, _)) = CLASSES.get(index as usize) else {
            return kInvalidArgument;
        };
        let info = unsafe { &mut *info };
        info.cid = *cid;
        info.cardinality = PClassInfo_::ClassCardinality_::kManyInstances as int32;
        copy(category, &mut info.category);
        copy(name, &mut info.name);
        kResultOk
    }

    unsafe fn createInstance(
        &self,
        cid: FIDString,
        iid: FIDString,
        obj: *mut *mut c_void,
    ) -> tresult {
        let cid = unsafe { *(cid as *const TUID) };
        let instance = if cid == GAIN_CID {
            ComWrapper::new(GainProcessor {
                level: AtomicU32::new(0.5f32.to_bits()),
            })
            .to_com_ptr::<FUnknown>()
        } else if cid == GAIN_CONTROLLER_CID {
            ComWrapper::new(GainController {
                level: Cell::new(0.5),
            })
            .to_com_ptr::<FUnknown>()
        } else if cid == TONE_CID {
            ComWrapper::new(ToneProcessor {
                level: Cell::new(0.0),
                key: Cell::new(None),
            })
            .to_com_ptr::<FUnknown>()
        } else {
            None
        };
        match instance {
            Some(instance) => {
                let ptr = instance.as_ptr();
                unsafe { ((*(*ptr).vtbl).queryInterface)(ptr, iid as *mut TUID, obj) }
            }
            None => kInvalidArgument,
        }
    }
}

impl IPluginFactory2Trait for Factory {
    unsafe fn getClassInfo2(&self, index: int32, info: *mut PClassInfo2) -> tresult {
        let Some((cid, category, name, sub_categories)) = CLASSES.get(index as usize) else {
            return kInvalidArgument;
        };
        let info = unsafe { &mut *info };
        info.cid = *cid;
        info.cardinality = PClassInfo_::ClassCardinality_::kManyInstances as int32;
        copy(category, &mut info.category);
        copy(name, &mut info.name);
        info.classFlags = 0;
        copy(sub_categories, &mut info.subCategories);
        copy(VENDOR, &mut info.vendor);
        copy(VERSION, &mut info.version);
        copy("VST 3.8.0", &mut info.sdkVersion);
        kResultOk
    }
}

/// Reads four bytes from a stream: a level.
unsafe fn read_level(stream: *mut IBStream) -> Option<f32> {
    let stream = unsafe { ComRef::from_raw(stream) }?;
    let mut bytes = [0u8; 4];
    let mut read = 0;
    let ok = unsafe { stream.read(bytes.as_mut_ptr().cast(), 4, &mut read) } == kResultOk;
    (ok && read == 4).then(|| f32::from_le_bytes(bytes))
}

/// The gain's processor: what goes through it, times its level.
struct GainProcessor {
    level: AtomicU32,
}

impl GainProcessor {
    fn level(&self) -> f32 {
        f32::from_bits(self.level.load(Ordering::Relaxed))
    }
}

impl Class for GainProcessor {
    type Interfaces = (IComponent, IAudioProcessor);
}

impl IPluginBaseTrait for GainProcessor {
    unsafe fn initialize(&self, _context: *mut FUnknown) -> tresult {
        kResultOk
    }

    unsafe fn terminate(&self) -> tresult {
        kResultOk
    }
}

impl IComponentTrait for GainProcessor {
    unsafe fn getControllerClassId(&self, class_id: *mut TUID) -> tresult {
        unsafe { *class_id = GAIN_CONTROLLER_CID };
        kResultOk
    }

    unsafe fn setIoMode(&self, _mode: IoMode) -> tresult {
        kResultOk
    }

    unsafe fn getBusCount(&self, media: MediaType, _dir: BusDirection) -> int32 {
        (media == MediaTypes_::kAudio as MediaType) as int32
    }

    unsafe fn getBusInfo(
        &self,
        media: MediaType,
        dir: BusDirection,
        index: int32,
        bus: *mut BusInfo,
    ) -> tresult {
        if media != MediaTypes_::kAudio as MediaType || index != 0 {
            return kInvalidArgument;
        }
        let bus = unsafe { &mut *bus };
        bus.mediaType = media;
        bus.direction = dir;
        bus.channelCount = 2;
        bus.busType = BusTypes_::kMain as BusType;
        bus.flags = BusInfo_::BusFlags_::kDefaultActive as uint32;
        kResultOk
    }

    unsafe fn getRoutingInfo(&self, _in: *mut RoutingInfo, _out: *mut RoutingInfo) -> tresult {
        kNotImplemented
    }

    unsafe fn activateBus(&self, _m: MediaType, _d: BusDirection, _i: int32, _s: TBool) -> tresult {
        kResultOk
    }

    unsafe fn setActive(&self, _state: TBool) -> tresult {
        kResultOk
    }

    unsafe fn setState(&self, state: *mut IBStream) -> tresult {
        match unsafe { read_level(state) } {
            Some(level) => {
                self.level.store(level.to_bits(), Ordering::Relaxed);
                kResultOk
            }
            None => kResultFalse,
        }
    }

    unsafe fn getState(&self, state: *mut IBStream) -> tresult {
        let Some(stream) = (unsafe { ComRef::from_raw(state) }) else {
            return kInvalidArgument;
        };
        let mut bytes = self.level().to_le_bytes();
        let mut written = 0;
        unsafe { stream.write(bytes.as_mut_ptr().cast(), 4, &mut written) }
    }
}

impl IAudioProcessorTrait for GainProcessor {
    unsafe fn setBusArrangements(
        &self,
        _inputs: *mut SpeakerArrangement,
        _num_ins: int32,
        _outputs: *mut SpeakerArrangement,
        _num_outs: int32,
    ) -> tresult {
        kResultTrue
    }

    unsafe fn getBusArrangement(
        &self,
        _dir: BusDirection,
        _index: int32,
        arr: *mut SpeakerArrangement,
    ) -> tresult {
        unsafe { *arr = SpeakerArr::kStereo };
        kResultOk
    }

    unsafe fn canProcessSampleSize(&self, size: int32) -> tresult {
        if size == SymbolicSampleSizes_::kSample32 as int32 {
            kResultOk
        } else {
            kNotImplemented
        }
    }

    unsafe fn getLatencySamples(&self) -> uint32 {
        0
    }

    unsafe fn setupProcessing(&self, _setup: *mut ProcessSetup) -> tresult {
        kResultOk
    }

    unsafe fn setProcessing(&self, _state: TBool) -> tresult {
        kResultOk
    }

    unsafe fn process(&self, data: *mut ProcessData) -> tresult {
        let data = unsafe { &*data };
        // Its one parameter, the level, from the edits this block brings.
        if let Some(changes) = unsafe { ComRef::from_raw(data.inputParameterChanges) } {
            for i in 0..unsafe { changes.getParameterCount() } {
                let Some(queue) = (unsafe { ComRef::from_raw(changes.getParameterData(i)) }) else {
                    continue;
                };
                let (mut offset, mut value) = (0, 0.0);
                let last = unsafe { queue.getPointCount() } - 1;
                if unsafe { queue.getParameterId() } == 0
                    && last >= 0
                    && unsafe { queue.getPoint(last, &mut offset, &mut value) } == kResultOk
                {
                    self.level
                        .store((value as f32).to_bits(), Ordering::Relaxed);
                }
            }
        }
        if data.numInputs < 1 || data.numOutputs < 1 {
            return kResultOk;
        }
        let n = data.numSamples as usize;
        let level = self.level();
        let (input, output) = unsafe { (&*data.inputs, &*data.outputs) };
        for c in 0..input.numChannels.min(output.numChannels) as usize {
            unsafe {
                let from = *input.__field0.channelBuffers32.add(c);
                let to = *output.__field0.channelBuffers32.add(c);
                for i in 0..n {
                    *to.add(i) = *from.add(i) * level;
                }
            }
        }
        kResultOk
    }

    unsafe fn getTailSamples(&self) -> uint32 {
        0
    }
}

/// The tone's processor (and its own controller: it has nothing to set).
struct ToneProcessor {
    level: Cell<f32>,
    key: Cell<Option<i16>>,
}

impl Class for ToneProcessor {
    type Interfaces = (IComponent, IAudioProcessor);
}

impl IPluginBaseTrait for ToneProcessor {
    unsafe fn initialize(&self, _context: *mut FUnknown) -> tresult {
        kResultOk
    }

    unsafe fn terminate(&self) -> tresult {
        kResultOk
    }
}

impl IComponentTrait for ToneProcessor {
    unsafe fn getControllerClassId(&self, _class_id: *mut TUID) -> tresult {
        kResultFalse
    }

    unsafe fn setIoMode(&self, _mode: IoMode) -> tresult {
        kResultOk
    }

    /// One event input, one audio output.
    unsafe fn getBusCount(&self, media: MediaType, dir: BusDirection) -> int32 {
        let input = dir == BusDirections_::kInput as BusDirection;
        let events = media == MediaTypes_::kEvent as MediaType;
        (events == input) as int32
    }

    unsafe fn getBusInfo(
        &self,
        media: MediaType,
        dir: BusDirection,
        index: int32,
        bus: *mut BusInfo,
    ) -> tresult {
        if index != 0 || unsafe { self.getBusCount(media, dir) } == 0 {
            return kInvalidArgument;
        }
        let bus = unsafe { &mut *bus };
        bus.mediaType = media;
        bus.direction = dir;
        bus.channelCount = if media == MediaTypes_::kAudio as MediaType {
            2
        } else {
            16
        };
        bus.busType = BusTypes_::kMain as BusType;
        bus.flags = BusInfo_::BusFlags_::kDefaultActive as uint32;
        kResultOk
    }

    unsafe fn getRoutingInfo(&self, _in: *mut RoutingInfo, _out: *mut RoutingInfo) -> tresult {
        kNotImplemented
    }

    unsafe fn activateBus(&self, _m: MediaType, _d: BusDirection, _i: int32, _s: TBool) -> tresult {
        kResultOk
    }

    unsafe fn setActive(&self, _state: TBool) -> tresult {
        kResultOk
    }

    unsafe fn setState(&self, _state: *mut IBStream) -> tresult {
        kResultOk
    }

    unsafe fn getState(&self, _state: *mut IBStream) -> tresult {
        kResultOk
    }
}

impl IAudioProcessorTrait for ToneProcessor {
    unsafe fn setBusArrangements(
        &self,
        _inputs: *mut SpeakerArrangement,
        _num_ins: int32,
        _outputs: *mut SpeakerArrangement,
        _num_outs: int32,
    ) -> tresult {
        kResultTrue
    }

    unsafe fn getBusArrangement(
        &self,
        _dir: BusDirection,
        _index: int32,
        arr: *mut SpeakerArrangement,
    ) -> tresult {
        unsafe { *arr = SpeakerArr::kStereo };
        kResultOk
    }

    unsafe fn canProcessSampleSize(&self, size: int32) -> tresult {
        if size == SymbolicSampleSizes_::kSample32 as int32 {
            kResultOk
        } else {
            kNotImplemented
        }
    }

    unsafe fn getLatencySamples(&self) -> uint32 {
        0
    }

    unsafe fn setupProcessing(&self, _setup: *mut ProcessSetup) -> tresult {
        kResultOk
    }

    unsafe fn setProcessing(&self, _state: TBool) -> tresult {
        kResultOk
    }

    unsafe fn process(&self, data: *mut ProcessData) -> tresult {
        let data = unsafe { &*data };
        if data.numOutputs < 1 {
            return kResultOk;
        }
        let n = data.numSamples.max(0) as usize;
        let output = unsafe { &*data.outputs };
        let write = |from: usize, to: usize, level: f32| {
            for c in 0..output.numChannels.max(0) as usize {
                let out = unsafe { *output.__field0.channelBuffers32.add(c) };
                for i in from..to {
                    unsafe { *out.add(i) = level };
                }
            }
        };
        let mut from = 0;
        if let Some(events) = unsafe { ComRef::from_raw(data.inputEvents) } {
            for i in 0..unsafe { events.getEventCount() } {
                let mut e: Event = unsafe { std::mem::zeroed() };
                if unsafe { events.getEvent(i, &mut e) } != kResultOk {
                    continue;
                }
                let at = (e.sampleOffset.max(0) as usize).min(n);
                write(from, at, self.level.get());
                from = at;
                if e.r#type == Event_::EventTypes_::kNoteOnEvent as uint16 {
                    let on = unsafe { e.__field0.noteOn };
                    self.key.set(Some(on.pitch));
                    self.level.set(on.velocity);
                } else if e.r#type == Event_::EventTypes_::kNoteOffEvent as uint16
                    && Some(unsafe { e.__field0.noteOff }.pitch) == self.key.get()
                {
                    self.key.set(None);
                    self.level.set(0.0);
                }
            }
        }
        write(from, n, self.level.get());
        kResultOk
    }

    unsafe fn getTailSamples(&self) -> uint32 {
        0
    }
}

/// The gain's controller: its one parameter, the level.
struct GainController {
    level: Cell<f64>,
}

impl Class for GainController {
    type Interfaces = (IEditController,);
}

impl IPluginBaseTrait for GainController {
    unsafe fn initialize(&self, _context: *mut FUnknown) -> tresult {
        kResultOk
    }

    unsafe fn terminate(&self) -> tresult {
        kResultOk
    }
}

impl IEditControllerTrait for GainController {
    unsafe fn setComponentState(&self, state: *mut IBStream) -> tresult {
        if let Some(level) = unsafe { read_level(state) } {
            self.level.set(f64::from(level));
        }
        kResultOk
    }

    unsafe fn setState(&self, _state: *mut IBStream) -> tresult {
        kResultOk
    }

    unsafe fn getState(&self, _state: *mut IBStream) -> tresult {
        kResultOk
    }

    unsafe fn getParameterCount(&self) -> int32 {
        1
    }

    unsafe fn getParameterInfo(&self, index: int32, info: *mut ParameterInfo) -> tresult {
        if index != 0 {
            return kInvalidArgument;
        }
        let info = unsafe { &mut *info };
        info.id = 0;
        info.stepCount = 0;
        info.defaultNormalizedValue = 0.5;
        info.flags = ParameterInfo_::ParameterFlags_::kCanAutomate as int32;
        kResultOk
    }

    unsafe fn getParamStringByValue(
        &self,
        _id: ParamID,
        _v: ParamValue,
        _s: *mut String128,
    ) -> tresult {
        kNotImplemented
    }

    unsafe fn getParamValueByString(
        &self,
        _id: ParamID,
        _s: *mut TChar,
        _v: *mut ParamValue,
    ) -> tresult {
        kNotImplemented
    }

    unsafe fn normalizedParamToPlain(&self, _id: ParamID, value: ParamValue) -> ParamValue {
        value
    }

    unsafe fn plainParamToNormalized(&self, _id: ParamID, value: ParamValue) -> ParamValue {
        value
    }

    unsafe fn getParamNormalized(&self, _id: ParamID) -> ParamValue {
        self.level.get()
    }

    unsafe fn setParamNormalized(&self, _id: ParamID, value: ParamValue) -> tresult {
        self.level.set(value);
        kResultOk
    }

    unsafe fn setComponentHandler(&self, _handler: *mut IComponentHandler) -> tresult {
        kResultOk
    }

    unsafe fn createView(&self, _name: FIDString) -> *mut IPlugView {
        std::ptr::null_mut()
    }
}

#[unsafe(no_mangle)]
extern "system" fn GetPluginFactory() -> *mut IPluginFactory {
    if !ENTERED.load(Ordering::SeqCst) {
        return std::ptr::null_mut();
    }
    ComWrapper::new(Factory)
        .to_com_ptr::<IPluginFactory>()
        .map_or(std::ptr::null_mut(), |f| f.into_raw())
}

fn enter() -> bool {
    ENTERED.store(true, Ordering::SeqCst);
    true
}

fn exit() -> bool {
    ENTERED.store(cfg!(target_os = "windows"), Ordering::SeqCst);
    true
}

#[cfg(target_os = "windows")]
#[unsafe(no_mangle)]
extern "system" fn InitDll() -> bool {
    enter()
}

#[cfg(target_os = "windows")]
#[unsafe(no_mangle)]
extern "system" fn ExitDll() -> bool {
    exit()
}

#[cfg(target_os = "macos")]
#[unsafe(no_mangle)]
extern "system" fn bundleEntry(bundle: *mut c_void) -> bool {
    !bundle.is_null() && enter()
}

#[cfg(target_os = "macos")]
#[unsafe(no_mangle)]
extern "system" fn bundleExit() -> bool {
    exit()
}

#[cfg(target_os = "linux")]
#[unsafe(no_mangle)]
extern "system" fn ModuleEntry(library: *mut c_void) -> bool {
    !library.is_null() && enter()
}

#[cfg(target_os = "linux")]
#[unsafe(no_mangle)]
extern "system" fn ModuleExit() -> bool {
    exit()
}

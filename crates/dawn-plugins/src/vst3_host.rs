//! Running VST3 plugins, as `host` runs CLAP ones: an instance (its
//! component, audio processor and edit controller) on the thread that made
//! it, and its processor on the audio thread, going home when it's dropped.
//!
//! What a VST3 host gives a plugin, made here: the host application (which
//! also makes the messages a separate controller and component talk with),
//! a component handler (a knob turned in the plugin's window is an edit,
//! sent to the processor with the next block, and makes its state dirty),
//! a plug frame (its window asks to be resized), and memory streams for its
//! state. A plugin's state is its component's and its controller's, one
//! after the other (`save_state`).

#![allow(non_snake_case)]

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::ffi::{CStr, c_void};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use rtrb::{Consumer, Producer, RingBuffer};
use vst3::Steinberg::Vst::*;
use vst3::Steinberg::*;
use vst3::{Class, ComPtr, ComWrapper, Interface};

use crate::vst3::{Module, class_id};

/// The most frames processed in one go: the engine's block.
pub const MAX_FRAMES: usize = 2048;
/// The most parameter edits a block carries to the processor.
const MAX_EDITS: usize = 256;

fn tuid_of(guid: &[u8; 16]) -> TUID {
    guid.map(|b| b as std::ffi::c_char)
}

fn same_id(a: *const TUID, iid: &[u8; 16]) -> bool {
    !a.is_null() && unsafe { *a }.map(|c| c as u8) == *iid
}

fn copy_wide(text: &str, to: &mut [TChar]) {
    let n = to.len() - 1;
    let mut i = 0;
    for unit in text.encode_utf16().take(n) {
        to[i] = unit as TChar;
        i += 1;
    }
    to[i] = 0;
}

// --- A memory stream (IBStream) ---

pub struct Stream {
    data: RefCell<Vec<u8>>,
    pos: Cell<usize>,
}

impl Class for Stream {
    type Interfaces = (IBStream,);
}

impl Stream {
    pub fn new(data: Vec<u8>) -> ComWrapper<Stream> {
        ComWrapper::new(Stream {
            data: RefCell::new(data),
            pos: Cell::new(0),
        })
    }
}

impl IBStreamTrait for Stream {
    unsafe fn read(
        &self,
        buffer: *mut c_void,
        numBytes: int32,
        numBytesRead: *mut int32,
    ) -> tresult {
        let data = self.data.borrow();
        let pos = self.pos.get().min(data.len());
        let n = (numBytes.max(0) as usize).min(data.len() - pos);
        if n > 0 && !buffer.is_null() {
            unsafe { std::ptr::copy_nonoverlapping(data[pos..].as_ptr(), buffer.cast(), n) };
        }
        self.pos.set(pos + n);
        if !numBytesRead.is_null() {
            unsafe { *numBytesRead = n as int32 };
        }
        kResultOk
    }

    unsafe fn write(
        &self,
        buffer: *mut c_void,
        numBytes: int32,
        numBytesWritten: *mut int32,
    ) -> tresult {
        let n = numBytes.max(0) as usize;
        let mut data = self.data.borrow_mut();
        let pos = self.pos.get();
        if data.len() < pos + n {
            data.resize(pos + n, 0);
        }
        if n > 0 && !buffer.is_null() {
            unsafe {
                std::ptr::copy_nonoverlapping(buffer.cast::<u8>(), data[pos..].as_mut_ptr(), n)
            };
        }
        self.pos.set(pos + n);
        if !numBytesWritten.is_null() {
            unsafe { *numBytesWritten = n as int32 };
        }
        kResultOk
    }

    unsafe fn seek(&self, pos: int64, mode: int32, result: *mut int64) -> tresult {
        let len = self.data.borrow().len() as i64;
        let base = match mode {
            IBStream_::IStreamSeekMode_::kIBSeekSet => 0,
            IBStream_::IStreamSeekMode_::kIBSeekCur => self.pos.get() as i64,
            IBStream_::IStreamSeekMode_::kIBSeekEnd => len,
            _ => return kInvalidArgument,
        };
        let to = (base + pos).max(0);
        self.pos.set(to as usize);
        if !result.is_null() {
            unsafe { *result = to };
        }
        kResultOk
    }

    unsafe fn tell(&self, pos: *mut int64) -> tresult {
        if !pos.is_null() {
            unsafe { *pos = self.pos.get() as int64 };
        }
        kResultOk
    }
}

// --- Messages between a component and its controller ---

enum Value {
    Int(i64),
    Float(f64),
    Text(Vec<TChar>),
    Bytes(Vec<u8>),
}

struct Attributes(RefCell<HashMap<Vec<u8>, Value>>);

impl Class for Attributes {
    type Interfaces = (IAttributeList,);
}

fn key(id: IAttributeList_::AttrID) -> Option<Vec<u8>> {
    (!id.is_null()).then(|| unsafe { CStr::from_ptr(id) }.to_bytes().to_vec())
}

impl IAttributeListTrait for Attributes {
    unsafe fn setInt(&self, id: IAttributeList_::AttrID, value: int64) -> tresult {
        let Some(k) = key(id) else {
            return kInvalidArgument;
        };
        self.0.borrow_mut().insert(k, Value::Int(value));
        kResultOk
    }
    unsafe fn getInt(&self, id: IAttributeList_::AttrID, value: *mut int64) -> tresult {
        match key(id).and_then(|k| match self.0.borrow().get(&k) {
            Some(Value::Int(v)) => Some(*v),
            _ => None,
        }) {
            Some(v) if !value.is_null() => {
                unsafe { *value = v };
                kResultOk
            }
            _ => kResultFalse,
        }
    }
    unsafe fn setFloat(&self, id: IAttributeList_::AttrID, value: f64) -> tresult {
        let Some(k) = key(id) else {
            return kInvalidArgument;
        };
        self.0.borrow_mut().insert(k, Value::Float(value));
        kResultOk
    }
    unsafe fn getFloat(&self, id: IAttributeList_::AttrID, value: *mut f64) -> tresult {
        match key(id).and_then(|k| match self.0.borrow().get(&k) {
            Some(Value::Float(v)) => Some(*v),
            _ => None,
        }) {
            Some(v) if !value.is_null() => {
                unsafe { *value = v };
                kResultOk
            }
            _ => kResultFalse,
        }
    }
    unsafe fn setString(&self, id: IAttributeList_::AttrID, string: *const TChar) -> tresult {
        let Some(k) = key(id) else {
            return kInvalidArgument;
        };
        if string.is_null() {
            return kInvalidArgument;
        }
        let mut text = Vec::new();
        let mut i = 0;
        while unsafe { *string.add(i) } != 0 {
            text.push(unsafe { *string.add(i) });
            i += 1;
        }
        self.0.borrow_mut().insert(k, Value::Text(text));
        kResultOk
    }
    unsafe fn getString(
        &self,
        id: IAttributeList_::AttrID,
        string: *mut TChar,
        sizeInBytes: uint32,
    ) -> tresult {
        let list = self.0.borrow();
        let Some(Value::Text(text)) = key(id).and_then(|k| list.get(&k)) else {
            return kResultFalse;
        };
        let room = sizeInBytes as usize / std::mem::size_of::<TChar>();
        if string.is_null() || room == 0 {
            return kInvalidArgument;
        }
        let n = text.len().min(room - 1);
        unsafe {
            std::ptr::copy_nonoverlapping(text.as_ptr(), string, n);
            *string.add(n) = 0;
        }
        kResultOk
    }
    unsafe fn setBinary(
        &self,
        id: IAttributeList_::AttrID,
        data: *const c_void,
        sizeInBytes: uint32,
    ) -> tresult {
        let Some(k) = key(id) else {
            return kInvalidArgument;
        };
        let bytes = if data.is_null() {
            Vec::new()
        } else {
            unsafe { std::slice::from_raw_parts(data.cast::<u8>(), sizeInBytes as usize) }.to_vec()
        };
        self.0.borrow_mut().insert(k, Value::Bytes(bytes));
        kResultOk
    }
    unsafe fn getBinary(
        &self,
        id: IAttributeList_::AttrID,
        data: *mut *const c_void,
        sizeInBytes: *mut uint32,
    ) -> tresult {
        let list = self.0.borrow();
        let Some(Value::Bytes(bytes)) = key(id).and_then(|k| list.get(&k)) else {
            return kResultFalse;
        };
        if data.is_null() || sizeInBytes.is_null() {
            return kInvalidArgument;
        }
        // The bytes stay where they are while the list lives.
        unsafe {
            *data = bytes.as_ptr().cast();
            *sizeInBytes = bytes.len() as uint32;
        }
        kResultOk
    }
}

struct Message {
    id: RefCell<Vec<u8>>,
    attributes: ComPtr<IAttributeList>,
}

impl Class for Message {
    type Interfaces = (IMessage,);
}

impl IMessageTrait for Message {
    unsafe fn getMessageID(&self) -> FIDString {
        self.id.borrow().as_ptr().cast()
    }
    unsafe fn setMessageID(&self, id: FIDString) {
        let mut text = if id.is_null() {
            Vec::new()
        } else {
            unsafe { CStr::from_ptr(id) }.to_bytes().to_vec()
        };
        text.push(0);
        *self.id.borrow_mut() = text;
    }
    unsafe fn getAttributes(&self) -> *mut IAttributeList {
        self.attributes.as_ptr()
    }
}

// --- The host's side ---

/// What the plugin tells the host, for the main thread to act on.
struct Shared {
    /// Edits made in its window (parameter, value), for the processor.
    edits: Mutex<Option<Producer<(ParamID, ParamValue)>>>,
    dirty: AtomicBool,
    restart: AtomicBool,
    /// A size its window asked for (width, height).
    resize: Mutex<Option<(i32, i32)>>,
}

struct Host {
    shared: Arc<Shared>,
}

impl Class for Host {
    type Interfaces = (IHostApplication, IComponentHandler, IPlugFrame);
}

impl IHostApplicationTrait for Host {
    unsafe fn getName(&self, name: *mut String128) -> tresult {
        if name.is_null() {
            return kInvalidArgument;
        }
        copy_wide("The Dawn Project", unsafe { &mut *name });
        kResultOk
    }

    unsafe fn createInstance(
        &self,
        cid: *mut TUID,
        _iid: *mut TUID,
        obj: *mut *mut c_void,
    ) -> tresult {
        if obj.is_null() {
            return kInvalidArgument;
        }
        let made = if same_id(cid, &IMessage::IID) {
            let attributes = ComWrapper::new(Attributes(RefCell::new(HashMap::new())))
                .to_com_ptr::<IAttributeList>()
                .expect("an attribute list");
            ComWrapper::new(Message {
                id: RefCell::new(vec![0]),
                attributes,
            })
            .to_com_ptr::<IMessage>()
            .map(|m| m.into_raw().cast::<c_void>())
        } else if same_id(cid, &IAttributeList::IID) {
            ComWrapper::new(Attributes(RefCell::new(HashMap::new())))
                .to_com_ptr::<IAttributeList>()
                .map(|a| a.into_raw().cast::<c_void>())
        } else {
            None
        };
        match made {
            Some(p) => {
                unsafe { *obj = p };
                kResultOk
            }
            None => {
                unsafe { *obj = std::ptr::null_mut() };
                kNoInterface
            }
        }
    }
}

impl IComponentHandlerTrait for Host {
    unsafe fn beginEdit(&self, _id: ParamID) -> tresult {
        kResultOk
    }

    unsafe fn performEdit(&self, id: ParamID, valueNormalized: ParamValue) -> tresult {
        if let Some(edits) = self
            .shared
            .edits
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_mut()
        {
            let _ = edits.push((id, valueNormalized));
        }
        self.shared.dirty.store(true, Ordering::Release);
        kResultOk
    }

    unsafe fn endEdit(&self, _id: ParamID) -> tresult {
        self.shared.dirty.store(true, Ordering::Release);
        kResultOk
    }

    unsafe fn restartComponent(&self, flags: int32) -> tresult {
        if flags & RestartFlags_::kLatencyChanged != 0 {
            self.shared.restart.store(true, Ordering::Release);
        }
        self.shared.dirty.store(true, Ordering::Release);
        kResultOk
    }
}

impl IPlugFrameTrait for Host {
    unsafe fn resizeView(&self, _view: *mut IPlugView, newSize: *mut ViewRect) -> tresult {
        if newSize.is_null() {
            return kInvalidArgument;
        }
        let r = unsafe { *newSize };
        *self.shared.resize.lock().unwrap_or_else(|e| e.into_inner()) =
            Some((r.right - r.left, r.bottom - r.top));
        kResultTrue
    }
}

// --- The edits a block carries (IParameterChanges) ---

struct Queue {
    id: Cell<ParamID>,
    points: RefCell<Vec<(int32, ParamValue)>>,
}

impl Class for Queue {
    type Interfaces = (IParamValueQueue,);
}

impl IParamValueQueueTrait for Queue {
    unsafe fn getParameterId(&self) -> ParamID {
        self.id.get()
    }
    unsafe fn getPointCount(&self) -> int32 {
        self.points.borrow().len() as int32
    }
    unsafe fn getPoint(
        &self,
        index: int32,
        sampleOffset: *mut int32,
        value: *mut ParamValue,
    ) -> tresult {
        let points = self.points.borrow();
        let Some(&(offset, v)) = points.get(index.max(0) as usize) else {
            return kInvalidArgument;
        };
        unsafe {
            if !sampleOffset.is_null() {
                *sampleOffset = offset;
            }
            if !value.is_null() {
                *value = v;
            }
        }
        kResultOk
    }
    unsafe fn addPoint(
        &self,
        sampleOffset: int32,
        value: ParamValue,
        index: *mut int32,
    ) -> tresult {
        let mut points = self.points.borrow_mut();
        if points.len() == points.capacity() {
            return kResultFalse;
        }
        points.push((sampleOffset, value));
        if !index.is_null() {
            unsafe { *index = points.len() as int32 - 1 };
        }
        kResultOk
    }
}

/// The edits for one block: a queue per parameter, made beforehand.
struct Changes {
    queues: Vec<(ComWrapper<Queue>, ComPtr<IParamValueQueue>)>,
    used: Cell<usize>,
}

impl Class for Changes {
    type Interfaces = (IParameterChanges,);
}

impl Changes {
    fn new() -> ComWrapper<Changes> {
        let queues = (0..MAX_EDITS)
            .map(|_| {
                let q = ComWrapper::new(Queue {
                    id: Cell::new(0),
                    points: RefCell::new(Vec::with_capacity(4)),
                });
                let p = q.to_com_ptr::<IParamValueQueue>().expect("a queue");
                (q, p)
            })
            .collect();
        ComWrapper::new(Changes {
            queues,
            used: Cell::new(0),
        })
    }

    fn clear(&self) {
        for (q, _) in &self.queues[..self.used.get()] {
            q.points.borrow_mut().clear();
        }
        self.used.set(0);
    }

    /// An edit at the block's start, the parameter's last if it has several.
    fn add(&self, id: ParamID, value: ParamValue) {
        let used = self.used.get();
        if let Some((q, _)) = self.queues[..used].iter().find(|(q, _)| q.id.get() == id) {
            let mut points = q.points.borrow_mut();
            points.clear();
            points.push((0, value));
            return;
        }
        if let Some((q, _)) = self.queues.get(used) {
            q.id.set(id);
            q.points.borrow_mut().push((0, value));
            self.used.set(used + 1);
        }
    }
}

impl IParameterChangesTrait for Changes {
    unsafe fn getParameterCount(&self) -> int32 {
        self.used.get() as int32
    }
    unsafe fn getParameterData(&self, index: int32) -> *mut IParamValueQueue {
        self.queues[..self.used.get()]
            .get(index.max(0) as usize)
            .map_or(std::ptr::null_mut(), |(_, p)| p.as_ptr())
    }
    unsafe fn addParameterData(
        &self,
        id: *const ParamID,
        index: *mut int32,
    ) -> *mut IParamValueQueue {
        if id.is_null() {
            return std::ptr::null_mut();
        }
        let id = unsafe { *id };
        let used = self.used.get();
        let at = match self.queues[..used]
            .iter()
            .position(|(q, _)| q.id.get() == id)
        {
            Some(at) => at,
            None if used < self.queues.len() => {
                self.queues[used].0.id.set(id);
                self.used.set(used + 1);
                used
            }
            None => return std::ptr::null_mut(),
        };
        if !index.is_null() {
            unsafe { *index = at as int32 };
        }
        self.queues[at].1.as_ptr()
    }
}

// --- The plugin ---

/// A COM pointer moved to the audio thread: the plugin's processor is
/// called from there, as VST3 has it.
struct AudioSide(ComPtr<IAudioProcessor>);

// SAFETY: VST3 has the host call the processor's process from its audio
// thread; the main thread doesn't call it meanwhile.
unsafe impl Send for AudioSide {}

/// The main thread's handle on a processor that's out: it's home when the
/// processor is dropped.
type Home = Arc<AtomicBool>;

/// A VST3 plugin's audio processor on the audio thread, with its buffers.
pub struct Vst3Processor {
    processor: AudioSide,
    home: Home,
    /// Each bus's channel count, inputs then outputs.
    inputs: Vec<i32>,
    outputs: Vec<i32>,
    buffers_in: Vec<Vec<f32>>,
    buffers_out: Vec<Vec<f32>>,
    /// Each channel's buffer, as the buses point to them (held only).
    #[allow(dead_code)]
    pointers_in: Vec<*mut f32>,
    #[allow(dead_code)]
    pointers_out: Vec<*mut f32>,
    buses_in: Vec<AudioBusBuffers>,
    buses_out: Vec<AudioBusBuffers>,
    edits: Consumer<(ParamID, ParamValue)>,
    changes: ComWrapper<Changes>,
    changes_ptr: ComPtr<IParameterChanges>,
}

// SAFETY: the raw pointers point into its own buffers, and the COM objects
// are only used from the thread it's on.
unsafe impl Send for Vst3Processor {}

impl Vst3Processor {
    /// Processes a stereo block in place (its main buses: a mono one takes
    /// both sides mixed and gives its one to both).
    pub fn process(&mut self, l: &mut [f32], r: &mut [f32]) {
        let n = l.len().min(r.len()).min(MAX_FRAMES);
        let main_in = self.inputs.first().copied().unwrap_or(0);
        for (c, buf) in self.buffers_in.iter_mut().enumerate() {
            let b = &mut buf[..n];
            match (c, main_in) {
                (0, 1) => b
                    .iter_mut()
                    .zip(l.iter().zip(r.iter()))
                    .for_each(|(x, (a, b))| *x = (a + b) * 0.5),
                (0, m) if m >= 1 => b.copy_from_slice(&l[..n]),
                (1, m) if m >= 2 => b.copy_from_slice(&r[..n]),
                _ => b.fill(0.0),
            }
        }
        self.changes.clear();
        while let Ok((id, value)) = self.edits.pop() {
            self.changes.add(id, value);
        }
        let mut data = ProcessData {
            processMode: ProcessModes_::kRealtime as int32,
            symbolicSampleSize: SymbolicSampleSizes_::kSample32 as int32,
            numSamples: n as int32,
            numInputs: self.buses_in.len() as int32,
            numOutputs: self.buses_out.len() as int32,
            inputs: self.buses_in.as_mut_ptr(),
            outputs: self.buses_out.as_mut_ptr(),
            inputParameterChanges: self.changes_ptr.as_ptr(),
            outputParameterChanges: std::ptr::null_mut(),
            inputEvents: std::ptr::null_mut(),
            outputEvents: std::ptr::null_mut(),
            processContext: std::ptr::null_mut(),
        };
        if unsafe { self.processor.0.process(&mut data) } != kResultOk {
            return;
        }
        match self.outputs.first().copied().unwrap_or(0) {
            0 => {}
            1 => {
                l[..n].copy_from_slice(&self.buffers_out[0][..n]);
                r[..n].copy_from_slice(&self.buffers_out[0][..n]);
            }
            _ => {
                l[..n].copy_from_slice(&self.buffers_out[0][..n]);
                r[..n].copy_from_slice(&self.buffers_out[1][..n]);
            }
        }
    }
}

impl Drop for Vst3Processor {
    fn drop(&mut self) {
        self.home.store(true, Ordering::Release);
    }
}

/// An instance of a VST3 plugin, on the thread that made it.
pub struct Vst3Plugin {
    component: ComPtr<IComponent>,
    processor: ComPtr<IAudioProcessor>,
    controller: Option<ComPtr<IEditController>>,
    /// The controller is an object of its own (not the component).
    separate: bool,
    connected: Option<(ComPtr<IConnectionPoint>, ComPtr<IConnectionPoint>)>,
    host: ComWrapper<Host>,
    shared: Arc<Shared>,
    home: Option<Home>,
    active: bool,
    view: Option<ComPtr<IPlugView>>,
    /// Keeps the module loaded while the plugin lives.
    _module: Arc<Module>,
}

fn bus_channels(component: &ComPtr<IComponent>, dir: BusDirections) -> Vec<i32> {
    let count =
        unsafe { component.getBusCount(MediaTypes_::kAudio as MediaType, dir as BusDirection) };
    (0..count)
        .map(|i| {
            let mut info: BusInfo = unsafe { std::mem::zeroed() };
            if unsafe {
                component.getBusInfo(
                    MediaTypes_::kAudio as MediaType,
                    dir as BusDirection,
                    i,
                    &mut info,
                )
            } == kResultOk
            {
                info.channelCount.max(0)
            } else {
                0
            }
        })
        .collect()
}

impl Vst3Plugin {
    /// Makes an instance of the plugin with class id `id` (as the scan
    /// writes it) in `module`.
    pub fn new(module: Arc<Module>, id: &str) -> Result<Self, String> {
        let factory = module.factory().ok_or("The plugin has no factory.")?;
        let cid = (0..unsafe { factory.countClasses() })
            .find_map(|i| {
                let mut info: PClassInfo = unsafe { std::mem::zeroed() };
                (unsafe { factory.getClassInfo(i, &mut info) } == kResultOk
                    && class_id(&info.cid) == id)
                    .then_some(info.cid)
            })
            .ok_or("The plugin isn't in its file any more.")?;
        let create = |cid: &TUID, iid: &[u8; 16]| -> Option<*mut c_void> {
            let mut obj: *mut c_void = std::ptr::null_mut();
            let iid = tuid_of(iid);
            let ok = unsafe { factory.createInstance(cid.as_ptr(), iid.as_ptr(), &mut obj) }
                == kResultOk;
            (ok && !obj.is_null()).then_some(obj)
        };
        let component = create(&cid, &IComponent::IID)
            .and_then(|p| unsafe { ComPtr::from_raw(p.cast::<IComponent>()) })
            .ok_or("The plugin couldn't be made.")?;
        let shared = Arc::new(Shared {
            edits: Mutex::new(None),
            dirty: AtomicBool::new(false),
            restart: AtomicBool::new(false),
            resize: Mutex::new(None),
        });
        let host = ComWrapper::new(Host {
            shared: shared.clone(),
        });
        let context = host.to_com_ptr::<FUnknown>().expect("the host");
        if unsafe { component.initialize(context.as_ptr()) } != kResultOk {
            return Err("The plugin couldn't start.".into());
        }
        let processor = component
            .cast::<IAudioProcessor>()
            .ok_or("It isn't an audio effect.")?;
        let (controller, separate) = match component.cast::<IEditController>() {
            Some(c) => (Some(c), false),
            None => {
                let mut ccid: TUID = [0; 16];
                let controller = (unsafe { component.getControllerClassId(&mut ccid) }
                    == kResultOk)
                    .then(|| create(&ccid, &IEditController::IID))
                    .flatten()
                    .and_then(|p| unsafe { ComPtr::from_raw(p.cast::<IEditController>()) })
                    .filter(|c| unsafe { c.initialize(context.as_ptr()) } == kResultOk);
                (controller, true)
            }
        };
        let mut plugin = Self {
            component,
            processor,
            controller,
            separate,
            connected: None,
            host,
            shared,
            home: None,
            active: false,
            view: None,
            _module: module,
        };
        if let Some(controller) = &plugin.controller {
            let handler = plugin
                .host
                .to_com_ptr::<IComponentHandler>()
                .expect("the handler");
            unsafe { controller.setComponentHandler(handler.as_ptr()) };
            if plugin.separate
                && let (Some(a), Some(b)) = (
                    plugin.component.cast::<IConnectionPoint>(),
                    controller.cast::<IConnectionPoint>(),
                )
            {
                unsafe {
                    a.connect(b.as_ptr());
                    b.connect(a.as_ptr());
                }
                plugin.connected = Some((a, b));
            }
        }
        plugin.sync_controller();
        Ok(plugin)
    }

    /// The controller learns the component's state (after it's set).
    fn sync_controller(&self) {
        let Some(controller) = &self.controller else {
            return;
        };
        let stream = Stream::new(Vec::new());
        let s = stream.to_com_ptr::<IBStream>().expect("a stream");
        if unsafe { self.component.getState(s.as_ptr()) } == kResultOk {
            stream.pos.set(0);
            unsafe { controller.setComponentState(s.as_ptr()) };
        }
    }

    /// Its state: the component's and the controller's, each after its
    /// length (four bytes, little-endian).
    pub fn save_state(&mut self) -> Result<Vec<u8>, String> {
        let part = |save: &dyn Fn(*mut IBStream) -> tresult| -> Vec<u8> {
            let stream = Stream::new(Vec::new());
            let s = stream.to_com_ptr::<IBStream>().expect("a stream");
            if save(s.as_ptr()) == kResultOk {
                stream.data.borrow().clone()
            } else {
                Vec::new()
            }
        };
        let component = part(&|s| unsafe { self.component.getState(s) });
        let controller = match (&self.controller, self.separate) {
            (Some(c), true) => part(&|s| unsafe { c.getState(s) }),
            _ => Vec::new(),
        };
        let mut out = Vec::with_capacity(8 + component.len() + controller.len());
        out.extend((component.len() as u32).to_le_bytes());
        out.extend(&component);
        out.extend((controller.len() as u32).to_le_bytes());
        out.extend(&controller);
        self.shared.dirty.store(false, Ordering::Release);
        Ok(out)
    }

    /// Gives it back a state it saved.
    pub fn load_state(&mut self, bytes: &[u8]) -> Result<(), String> {
        let bad = || "Its saved state isn't one it saved.".to_owned();
        let take = |at: usize| -> Option<(&[u8], usize)> {
            let len = u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?) as usize;
            Some((bytes.get(at + 4..at + 4 + len)?, at + 4 + len))
        };
        let (component, next) = take(0).ok_or_else(bad)?;
        let (controller, _) = take(next).unwrap_or((&[], next));
        let stream = Stream::new(component.to_vec());
        let s = stream.to_com_ptr::<IBStream>().expect("a stream");
        if unsafe { self.component.setState(s.as_ptr()) } != kResultOk {
            return Err("The plugin couldn't load its state.".into());
        }
        self.sync_controller();
        if let (Some(c), true, false) = (&self.controller, self.separate, controller.is_empty()) {
            let stream = Stream::new(controller.to_vec());
            let s = stream.to_com_ptr::<IBStream>().expect("a stream");
            unsafe { c.setState(s.as_ptr()) };
        }
        Ok(())
    }

    /// An edit of a parameter, as its window makes one (through the
    /// component handler): it reaches the processor with the next block.
    pub fn edit(&self, id: u32, value: f64) {
        let handler = self
            .host
            .to_com_ptr::<IComponentHandler>()
            .expect("the handler");
        unsafe {
            handler.beginEdit(id);
            handler.performEdit(id, value);
            handler.endEdit(id);
        }
    }

    /// Whether its state changed since it was last saved; once.
    pub fn take_dirty(&self) -> bool {
        self.shared.dirty.swap(false, Ordering::AcqRel)
    }

    /// How late its sound comes out (frames).
    pub fn latency(&self) -> u32 {
        unsafe { self.processor.getLatencySamples() }
    }

    /// Takes its processor back if it's come home: stopped and inactive.
    pub fn reclaim(&mut self) {
        if self
            .home
            .as_ref()
            .is_some_and(|h| h.load(Ordering::Acquire))
        {
            self.home = None;
            self.deactivate();
        }
    }

    fn deactivate(&mut self) {
        if self.active {
            unsafe {
                self.processor.setProcessing(0);
                self.component.setActive(0);
            }
            self.active = false;
        }
        *self.shared.edits.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }

    pub fn is_out(&self) -> bool {
        self.home.is_some()
    }

    /// Activates it at `sample_rate` and hands out its processor; None
    /// while one is out already.
    pub fn processor(&mut self, sample_rate: f64) -> Result<Option<Vst3Processor>, String> {
        self.reclaim();
        if self.is_out() {
            return Ok(None);
        }
        let inputs = bus_channels(&self.component, BusDirections_::kInput);
        let outputs = bus_channels(&self.component, BusDirections_::kOutput);
        // Stereo main buses if it takes them; it keeps its own otherwise.
        let mut ins: Vec<SpeakerArrangement> = inputs.iter().map(|_| SpeakerArr::kStereo).collect();
        let mut outs: Vec<SpeakerArrangement> =
            outputs.iter().map(|_| SpeakerArr::kStereo).collect();
        unsafe {
            self.processor.setBusArrangements(
                ins.as_mut_ptr(),
                ins.len() as int32,
                outs.as_mut_ptr(),
                outs.len() as int32,
            );
        }
        let inputs = bus_channels(&self.component, BusDirections_::kInput);
        let outputs = bus_channels(&self.component, BusDirections_::kOutput);
        for (dir, count) in [
            (BusDirections_::kInput, inputs.len()),
            (BusDirections_::kOutput, outputs.len()),
        ] {
            for i in 0..count {
                unsafe {
                    self.component.activateBus(
                        MediaTypes_::kAudio as MediaType,
                        dir as BusDirection,
                        i as int32,
                        1,
                    )
                };
            }
        }
        let mut setup = ProcessSetup {
            processMode: ProcessModes_::kRealtime as int32,
            symbolicSampleSize: SymbolicSampleSizes_::kSample32 as int32,
            maxSamplesPerBlock: MAX_FRAMES as int32,
            sampleRate: sample_rate,
        };
        if unsafe { self.processor.setupProcessing(&mut setup) } != kResultOk {
            return Err("The plugin can't play at this rate.".into());
        }
        if unsafe { self.component.setActive(1) } != kResultOk {
            return Err("The plugin couldn't start.".into());
        }
        unsafe { self.processor.setProcessing(1) };
        self.active = true;
        let (edits_tx, edits) = RingBuffer::new(MAX_EDITS * 4);
        *self.shared.edits.lock().unwrap_or_else(|e| e.into_inner()) = Some(edits_tx);
        let buffers = |counts: &[i32]| -> Vec<Vec<f32>> {
            (0..counts.iter().sum::<i32>())
                .map(|_| vec![0.0; MAX_FRAMES])
                .collect()
        };
        let mut buffers_in = buffers(&inputs);
        let mut buffers_out = buffers(&outputs);
        let mut pointers_in: Vec<*mut f32> =
            buffers_in.iter_mut().map(|b| b.as_mut_ptr()).collect();
        let mut pointers_out: Vec<*mut f32> =
            buffers_out.iter_mut().map(|b| b.as_mut_ptr()).collect();
        let buses = |counts: &[i32], pointers: &mut Vec<*mut f32>| -> Vec<AudioBusBuffers> {
            let mut at = 0usize;
            counts
                .iter()
                .map(|&c| {
                    let mut bus: AudioBusBuffers = unsafe { std::mem::zeroed() };
                    bus.numChannels = c;
                    bus.__field0.channelBuffers32 = unsafe { pointers.as_mut_ptr().add(at) };
                    at += c as usize;
                    bus
                })
                .collect()
        };
        let buses_in = buses(&inputs, &mut pointers_in);
        let buses_out = buses(&outputs, &mut pointers_out);
        let changes = Changes::new();
        let changes_ptr = changes.to_com_ptr::<IParameterChanges>().expect("changes");
        let home = Arc::new(AtomicBool::new(false));
        self.home = Some(home.clone());
        Ok(Some(Vst3Processor {
            processor: AudioSide(self.processor.clone()),
            home,
            inputs,
            outputs,
            buffers_in,
            buffers_out,
            pointers_in,
            pointers_out,
            buses_in,
            buses_out,
            edits,
            changes,
            changes_ptr,
        }))
    }

    /// What it asked for since: a latency change is taken up when its
    /// processor next comes out.
    pub fn tick(&mut self) {
        self.shared.restart.store(false, Ordering::Release);
        self.reclaim();
    }

    // --- Its window ---

    fn platform() -> FIDString {
        if cfg!(target_os = "macos") {
            kPlatformTypeNSView
        } else {
            kPlatformTypeHWND
        }
    }

    /// Puts its editor in `parent` (an HWND on Windows, an NSView on
    /// macOS), and says how big it is.
    ///
    /// # Safety
    /// `parent` must stay alive until `close_gui`.
    pub unsafe fn open_gui(&mut self, parent: *mut c_void) -> Result<(i32, i32), String> {
        self.close_gui();
        let controller = self
            .controller
            .as_ref()
            .ok_or("The plugin has no window of its own.")?;
        let view = unsafe { ComPtr::from_raw(controller.createView(ViewType::kEditor)) }
            .ok_or("The plugin has no window of its own.")?;
        if unsafe { view.isPlatformTypeSupported(Self::platform()) } != kResultTrue {
            return Err("The plugin's window doesn't work on this system.".into());
        }
        let frame = self.host.to_com_ptr::<IPlugFrame>().expect("the frame");
        unsafe { view.setFrame(frame.as_ptr()) };
        if unsafe { view.attached(parent, Self::platform()) } != kResultOk {
            return Err("The plugin couldn't go in its window.".into());
        }
        let mut rect = ViewRect {
            left: 0,
            top: 0,
            right: 600,
            bottom: 400,
        };
        unsafe { view.getSize(&mut rect) };
        self.view = Some(view);
        Ok((rect.right - rect.left, rect.bottom - rect.top))
    }

    pub fn close_gui(&mut self) {
        if let Some(view) = self.view.take() {
            unsafe {
                view.removed();
                view.setFrame(std::ptr::null_mut());
            }
        }
    }

    /// A size its window asked for, once: the window takes it, and the
    /// editor is told.
    pub fn take_gui_resize(&mut self) -> Option<(i32, i32)> {
        let size = self
            .shared
            .resize
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()?;
        if let Some(view) = &self.view {
            let mut rect = ViewRect {
                left: 0,
                top: 0,
                right: size.0,
                bottom: size.1,
            };
            unsafe { view.onSize(&mut rect) };
        }
        Some(size)
    }
}

impl Drop for Vst3Plugin {
    fn drop(&mut self) {
        self.close_gui();
        self.reclaim();
        if !self.is_out() {
            self.deactivate();
        }
        unsafe {
            if let Some((a, b)) = self.connected.take() {
                a.disconnect(b.as_ptr());
                b.disconnect(a.as_ptr());
            }
            if let Some(c) = self.controller.take() {
                c.setComponentHandler(std::ptr::null_mut());
                if self.separate {
                    c.terminate();
                }
            }
            self.component.terminate();
        }
    }
}

/// Loads the VST3 module (bundle or file) at `path`.
///
/// # Safety
/// This runs the plugin's own code, which can do anything.
pub unsafe fn load_module(path: &Path) -> Result<Arc<Module>, String> {
    unsafe { Module::load(path) }.map(Arc::new)
}

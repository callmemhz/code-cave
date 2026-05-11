/// Bounded byte buffer that keeps the *most recent* N bytes.
/// Implemented as a VecDeque<u8> — simple, fast enough for ~400KB.
pub struct RingBuf {
    inner: std::collections::VecDeque<u8>,
    cap: usize,
}

impl RingBuf {
    pub fn new(cap: usize) -> Self {
        Self { inner: std::collections::VecDeque::with_capacity(cap), cap }
    }

    pub fn push(&mut self, bytes: &[u8]) {
        // If bytes alone exceed cap, only keep the tail.
        let slice = if bytes.len() >= self.cap {
            self.inner.clear();
            &bytes[bytes.len() - self.cap..]
        } else {
            // Trim from front to make room.
            let overflow = self.inner.len() + bytes.len();
            if overflow > self.cap {
                for _ in 0..(overflow - self.cap) {
                    self.inner.pop_front();
                }
            }
            bytes
        };
        self.inner.extend(slice.iter().copied());
    }

    pub fn snapshot(&self) -> Vec<u8> {
        self.inner.iter().copied().collect()
    }

    pub fn len(&self) -> usize { self.inner.len() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_recent_bytes_under_cap() {
        let mut b = RingBuf::new(10);
        b.push(b"hello");
        b.push(b" world");
        // total 11, cap 10 → drops first byte 'h'
        assert_eq!(b.snapshot(), b"ello world");
    }

    #[test]
    fn single_push_bigger_than_cap_keeps_tail() {
        let mut b = RingBuf::new(5);
        b.push(b"abcdefghij");
        assert_eq!(b.snapshot(), b"fghij");
    }

    #[test]
    fn empty_after_init() {
        let b = RingBuf::new(10);
        assert_eq!(b.len(), 0);
        assert_eq!(b.snapshot(), b"");
    }
}

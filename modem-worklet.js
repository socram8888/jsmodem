'use strict';

class FskModulatorProcessor extends AudioWorkletProcessor {
	constructor() {
		super();

		this.params = null;

		// Initialize counters
		this.sampleCount = 0;
		this.symbolCount = 0;
		this.currentPhase = 0;

		// Flag that will be set once the tail has been sent
		this.tailSent = false;

		// Flag that will be set once we've notified the node via the port that we're done
		this.notifiedNode = false;

		// Setup message callback
		this.port.onmessage = msg => {
			this.params = msg.data;

			// Precalculate some often used values
			this.spacePhaseDelta = 2 * Math.PI * this.params.fskParams.space / sampleRate;
			this.markPhaseDelta = 2 * Math.PI * this.params.fskParams.mark / sampleRate;
			this.samplesPerBit = sampleRate / this.params.fskParams.baud;

			// Emit preamble
			this.currentPhaseDelta = this.markPhaseDelta;
			this.symbolEnd = this.params.preamble * sampleRate;

		}
		this.port.start();
	}

	nextSymbol() {
		// If the tail has been sent already, we're done
		if (this.tailSent) {
			// If the node hasn't been notified yet, do so now
			if (!this.notifiedNode) {
				this.port.postMessage({
					done: true
				});
				this.notifiedNode = true;
			}

			return false;
		}

		/*
		 * Calculate byte index.
		 *
		 * We have to divide by 10 because for every 8-bit byte we also have to send one start
		 * bit and one stop bit.
		 */
		const byteIdx = (this.symbolCount / 10) | 0;

		// If we haven't reached yet the end of the current message...
		if (byteIdx < this.params.bytes.length) {
			// Extract bit
			const bitIdx = this.symbolCount % 10 - 1;
			let symbol;

			switch (bitIdx) {
				case -1:
					// Send start bit
					symbol = 0;
					break;

				default:
					// Extract actual bit
					symbol = (this.params.bytes[byteIdx] >> bitIdx) & 1;
					break;

				case 8:
					// Send stop bit
					symbol = 1;
					break;
			}

			this.currentPhaseDelta = symbol ? this.markPhaseDelta : this.spacePhaseDelta;
			this.symbolEnd += this.samplesPerBit;
			this.symbolCount++;

			return true;
		}

		// If transmission is over, send tail
		this.currentPhaseDelta = this.markPhaseDelta;
		this.symbolEnd += this.params.tail * sampleRate;
		this.tailSent = true;
		return true;
	}

	process(inputs, outputs, parameters) {
		// If hasn't been initialized yet, return
		if (!this.params) {
			return true;
		}

		// Might happen if called before connecting the output
		if (!outputs || !outputs[0] || !outputs[0][0]) {
			return true;
		}

		const output = outputs[0][0];
		let outputPos = 0;

		while (outputPos < output.length) {
			if (this.sampleCount >= this.symbolEnd) {
				// If nextSymbol returns false, we're done and we can be garbage collected
				if (!this.nextSymbol()) {
					return false;
				}
			}

			// Generate actual sample
			output[outputPos] = Math.sin(this.currentPhase);
			outputPos++;

			// Increment phase, capped at 2pi to reduce precision loss
			this.currentPhase += this.currentPhaseDelta;
			if (this.currentPhase > Math.PI * 2) {
				this.currentPhase -= Math.PI * 2;
			}

			// Step sample counter
			this.sampleCount++;
		}

		return true;
	}
}

registerProcessor('fsk-modulator', FskModulatorProcessor)

class UartReceiver {
	constructor(port) {
		this.port = port;

		this.bytes = new Array();
		this.symbolCount = 0;
		this.symbolBuffer = 0;

		this.startTime = null;
	}

	feedBit(bit) {
		if (this.symbolCount == 0 && this.bytes.length == 0) {
			this.startTime = new Date();
		}

		// Feed bit into buffer
		this.symbolBuffer = bit << 9 | this.symbolBuffer >> 1;
		this.symbolCount++;

		if (this.symbolCount >= 10) {
			// Check that the start bit is low and stop is high
			if ((this.symbolBuffer & 0x201) == 0x200) {
				/*
				 * If it is, a byte has been successfully received.
				 * Add it to the byte buffer and clear the symbol buffer.
				 */
				this.bytes.push((this.symbolBuffer >> 1) & 0xFF);
				this.symbolCount = 0;
			} else {
				/*
				 * Else, we hit an error condition.
				 *
				 * If the bytes buffer contains anything send it now as is.
				 *
				 * We won't reset the symbol count, as this might happen not only in case of
				 * synchronization loss but also if the message is in the lead-in.
				 */
				this.messageOver();
			}
		}
	}

	rxFail() {
		this.messageOver();
		this.symbolCount = 0;
	}

	messageOver() {
		if (this.bytes.length > 0) {
			this.port.postMessage({
				bytes: new Uint8Array(this.bytes),
				start: this.startTime,
				end: new Date()
			});
		}
		this.bytes = new Array();
	}
}

class FskDemodulatorProcessor extends AudioWorkletProcessor {
	// Experimentally determined to give the best results in noisy environments
	CORR_RATIO = 6 / 8;

	constructor() {
		super();

		this.params = null;
		this.receiver = new UartReceiver(this.port);

		this.port.onmessage = msg => {
			this.params = msg.data;

			// Precalculate some often used values
			this.bitsPerSample = this.params.fskParams.baud / sampleRate;

			/**
			 * Set if output of the correlator should be inverted.
			 *
			 * The correlator sum's sign indicates if the frequency is leaning towards the lower
			 * frequency (negative sum) or high frequency (positive sum).
			 *
			 * If we assume the space's frequency is lower than the mark's, a negative indicates a
			 * binary 0 and a positive indicates a binary 1.
			 *
			 * However, if the space's frequency is higher than the mark's, the above logic needs to
			 * be inverted. This flag marks that.
			 */
			this.invertCorr = this.params.fskParams.space > this.params.fskParams.mark;

			// Delay line, large enough to hold the optimal delay
			const delaySize = Math.round(this.params.fskParams.rxDelay * sampleRate) - 1;
			this.delay = new Int8Array(delaySize);
			this.delayPos = 0;

			// Instantiate correlator buffer
			const corSize = Math.round(this.CORR_RATIO * sampleRate / this.params.fskParams.baud);
			this.correlator = new Int8Array(corSize);
			this.corrPos = 0;
			this.corrSum = 0;

			// No bits have been emitted yet
			this.previousBit = null;
			this.emittedBits = 0;
		}
		this.port.start();
	}

	process(inputs, outputs, parameters) {
		// If hasn't been initialized yet, return
		if (!this.params) {
			return true;
		}

		// Might happen if called before connecting the input
		if (!inputs || !inputs[0] || !inputs[0][0]) {
			return true;
		}

		for (let value of inputs[0][0]) {
			// Calculate the polarity of the current sample
			let curPolarity = value >= 0 ? 1 : -1;

			/*
			 * Multiply with the output of the delay.
			 *
			 * We don't need to special case the start since the buffers are all zero,
			 * so the resulting multiplications will be zero.
			 */
			let newCorrPolarity = this.delay[this.delayPos] * curPolarity;

			// Update the current correlator sum
			let oldCorrPolarity = this.correlator[this.corrPos];
			this.corrSum = this.corrSum - oldCorrPolarity + newCorrPolarity;

			// Overwrite old correlator output
			this.correlator[this.corrPos] = newCorrPolarity;
			this.corrPos = (this.corrPos + 1) % this.correlator.length;

			// Calculate current bit value
			let currentBit = (this.corrSum >= 0) ^ this.invertCorr;

			if (currentBit == this.previousBit) {
				// Cast to int to floor it
				const previousEmitted = this.emittedBits | 0;
				this.emittedBits += this.bitsPerSample;
				const newEmitted = this.emittedBits | 0;

				// If we have received a new full bit, feed it
				if (previousEmitted != newEmitted) {
					this.receiver.feedBit(currentBit);
				}
			} else {
				/*
				 * If not a single valid bit has been emitted since last polarity change,
				 * the transmission is damaged
				 */
				if (this.emittedBits < 1) {
					this.receiver.rxFail();
				}

				this.previousBit = currentBit;

				// Assume we're in the middle of a valid bit
				this.emittedBits = 0.5;
			}

			// Overwrite old sample in the delay line with the new value
			this.delay[this.delayPos] = curPolarity;
			this.delayPos = (this.delayPos + 1) % this.delay.length;
		}

		return true;
	}
}

registerProcessor('fsk-demodulator', FskDemodulatorProcessor)

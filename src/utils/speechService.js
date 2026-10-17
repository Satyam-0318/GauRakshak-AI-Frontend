/**
 * GauRakshak AI - Robust Text-to-Speech Voice Assistant
 * 
 * Solves browser speech synthesis edge-cases:
 * 1. Chromium / WebKit Garbage Collection Bug (stores utterance in window._gauRakshakUtterance)
 * 2. Instant cancel-then-speak audio queue collision (adds safe 60ms delay)
 * 3. Mismatched voice selection (intelligently matches Hindi hi-IN and natural Indian/US English)
 * 4. Awkward tongue-twisting pronunciation (cleans alphanumeric RFIDs, dashes, ISO timestamps)
 * 5. Pacing and pitch tuning for clear rural and clinical comprehension
 */

// Global reference prevents Garbage Collection mid-sentence
if (typeof window !== 'undefined') {
  window._gauRakshakUtterance = null;
}

let cachedVoices = [];

// Preload voices
const loadVoices = () => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  const voices = window.speechSynthesis.getVoices();
  if (voices && voices.length > 0) {
    cachedVoices = voices;
  }
  return cachedVoices;
};

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    loadVoices();
  };
}

/**
 * Finds the most natural, fluent voice available for the specified language
 */
export const getBestVoice = (targetLang = 'en-US') => {
  const voices = cachedVoices.length > 0 ? cachedVoices : loadVoices();
  if (!voices || voices.length === 0) return null;

  const isHindi = targetLang.startsWith('hi');

  if (isHindi) {
    // 1. Look for native Hindi voices (e.g., Google हिन्दी, Lekha, Neerja, Kalpana, hi-IN)
    const hiVoice = voices.find(v => 
      (v.lang && (v.lang === 'hi-IN' || v.lang.startsWith('hi'))) ||
      (v.name && /hindi|हिन्दी/i.test(v.name))
    );
    if (hiVoice) return hiVoice;

    // 2. Indian English voice handles Indian phonetics and names much better than US/UK
    const inEnVoice = voices.find(v => 
      v.lang === 'en-IN' || 
      /india|rishi|veena/i.test(v.name)
    );
    if (inEnVoice) return inEnVoice;
  } else {
    // English: Prefer clear natural voices (Indian English or natural US/UK)
    const preferredVoice = voices.find(v => 
      v.lang === 'en-IN' || 
      (/google/i.test(v.name) && v.lang.startsWith('en')) ||
      /samantha|karen|moira|daniel/i.test(v.name)
    );
    if (preferredVoice) return preferredVoice;

    const enVoice = voices.find(v => v.lang && v.lang.startsWith('en'));
    if (enVoice) return enVoice;
  }

  // Fallback to default voice or first available
  return voices.find(v => v.default) || voices[0] || null;
};

/**
 * Normalizes cow name & tag for natural human-like speech
 * Strips raw hyphens, duplicate 'Cow' prefixes, and converts IDs into clean spoken numbers
 */
export const cleanCowSpeechIdentity = (cowName = '', rfid = '', isHindi = false) => {
  let name = (cowName || '').trim();
  let tag = (rfid || '').trim();

  // If no name or name is just RFID, clean it
  if (!name || name.toLowerCase() === tag.toLowerCase() || name.toLowerCase().startsWith('cow rfid')) {
    // Extract numbers from tag (e.g. 'RFID-IND-1001' -> '1001')
    const numbersMatch = tag.match(/\d+/g);
    const numericPart = numbersMatch ? numbersMatch.join(' ') : tag.replace(/[-_]/g, ' ');
    
    if (isHindi) {
      return {
        spokenName: `टैग संख्या ${numericPart}`,
        tagShort: numericPart
      };
    } else {
      return {
        spokenName: `Cow ${numericPart}`,
        tagShort: numericPart
      };
    }
  }

  // If name has "Cow " prefix, keep it simple
  const cleanName = name.replace(/^cow\s+/i, '');
  
  // Clean tag to avoid reciting "hyphen" or "dash"
  const tagNumbers = tag.match(/\d+/g);
  const tagSpoken = tagNumbers ? tagNumbers.join(' ') : tag.replace(/[-_]/g, ' ');

  return {
    spokenName: cleanName,
    tagShort: tagSpoken
  };
};

/**
 * Converts ISO/database timestamp to smooth spoken phrase
 */
export const formatSpokenDate = (timestampStr, isHindi = false) => {
  if (!timestampStr) return isHindi ? 'हालिया जांच' : 'Recent test';
  
  try {
    const d = new Date(timestampStr.replace(' ', 'T'));
    if (isNaN(d.getTime())) {
      // Fallback: extract date portion e.g. "2026-09-12"
      const datePart = timestampStr.split(' ')[0] || timestampStr.split('T')[0];
      return datePart.replace(/[-_]/g, ' ');
    }
    
    const day = d.getDate();
    const monthsEn = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const monthsHi = ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितम्बर', 'अक्टूबर', 'नवम्बर', 'दिसम्बर'];
    
    const month = isHindi ? monthsHi[d.getMonth()] : monthsEn[d.getMonth()];
    
    if (isHindi) {
      return `${day} ${month}`;
    } else {
      return `${month} ${day}`;
    }
  } catch (e) {
    return isHindi ? 'हालिया जांच' : 'Recent test';
  }
};

/**
 * Core text-to-speech executor with full stability guards
 */
export const speakFluentText = ({
  text,
  lang = 'en-US',
  rate = 0.88, // Natural, steady, clear pacing
  pitch = 1.0,
  onStart,
  onEnd,
  onError
}) => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    console.warn('SpeechSynthesis not supported on this device.');
    if (onError) onError(new Error('SpeechSynthesis not supported'));
    return;
  }

  // 1. Cancel previous speech immediately
  window.speechSynthesis.cancel();
  window._gauRakshakUtterance = null;

  if (!text || !text.trim()) {
    if (onEnd) onEnd();
    return;
  }

  // 2. Prepare text: clean multiple spaces and replace raw underscores/dashes with spaces
  const sanitizedText = text
    .replace(/[–—_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const utterance = new SpeechSynthesisUtterance(sanitizedText);
  utterance.lang = lang;
  utterance.rate = rate;
  utterance.pitch = pitch;

  // 3. Assign optimal voice
  const matchedVoice = getBestVoice(lang);
  if (matchedVoice) {
    utterance.voice = matchedVoice;
  }

  // 4. Attach lifecycle listeners with state cleanup
  utterance.onstart = () => {
    if (onStart) onStart();
  };

  utterance.onend = () => {
    window._gauRakshakUtterance = null;
    if (onEnd) onEnd();
  };

  utterance.onerror = (event) => {
    // 'interrupted' or 'canceled' are normal user actions, not real errors
    window._gauRakshakUtterance = null;
    if (event.error !== 'interrupted' && event.error !== 'canceled') {
      console.warn('Speech synthesis event notice:', event.error);
    }
    if (onEnd) onEnd();
    if (onError && event.error !== 'interrupted' && event.error !== 'canceled') {
      onError(event);
    }
  };

  // 5. Store globally to defeat garbage collection bug
  window._gauRakshakUtterance = utterance;

  // 6. 60ms delay prevents the Chrome audio hardware cancel race-condition
  setTimeout(() => {
    try {
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.error('Error starting speech synthesis:', err);
      if (onEnd) onEnd();
    }
  }, 60);
};

/**
 * Stops any active speech synthesis cleanly
 */
export const stopSpeech = () => {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    window._gauRakshakUtterance = null;
  }
};

/**
 * Builds and speaks clear veterinary diagnosis for a cow (RFID or Single test)
 */
export const speakCowDiagnosis = ({
  cowName,
  rfid,
  stage = 'Healthy',
  language = 'en',
  onStart,
  onEnd,
  onError
}) => {
  const isHindi = language === 'hi';
  const { spokenName, tagShort } = cleanCowSpeechIdentity(cowName, rfid, isHindi);

  let text = '';
  const langCode = isHindi ? 'hi-IN' : 'en-US';

  if (isHindi) {
    if (stage === 'Healthy') {
      text = `गाय ${spokenName}, परिणाम: थन पूरी तरह स्वस्थ है। दूध शुद्ध और सुरक्षित है। कोई संक्रमण नहीं है। नियमित दुग्ध दोहन जारी रखें।`;
    } else if (stage === 'Subclinical') {
      text = `सावधानी! गाय ${spokenName} में प्रारंभिक थनैल संक्रमण के लक्षण पाए गए हैं। दूध में सोमैटिक सेल और चालकता बढ़ रही है। कृपया स्थानीय पशु चिकित्सक को दिखाएं और थन का सीएमटी परीक्षण करें।`;
    } else {
      text = `आपातकालीन चेतावनी! गाय ${spokenName} में गंभीर थनैल रोग पाया गया है। कृपया इस गाय को तुरंत अन्य गायों से अलग करें। यह दूध बिल्कुल न निकालें और तुरंत पशु चिकित्सक से संपर्क करें।`;
    }
  } else {
    if (stage === 'Healthy') {
      text = `Diagnosis for Cow ${spokenName}, Tag ${tagShort}. Result: Healthy udder. Milk is pure and safe with normal cell counts. Continue regular milking.`;
    } else if (stage === 'Subclinical') {
      text = `Caution. Cow ${spokenName}, Tag ${tagShort} shows mild subclinical mastitis. Somatic cell count and electrical conductivity are elevated. Please consult your dairy veterinarian soon.`;
    } else {
      text = `Urgent alert! Cow ${spokenName}, Tag ${tagShort} is diagnosed with clinical mastitis. Isolate this cow immediately, do not use the milk, and contact your veterinarian for emergency treatment.`;
    }
  }

  speakFluentText({
    text,
    lang: langCode,
    rate: isHindi ? 0.86 : 0.90, // Slightly paced for Hindi phonetics
    pitch: 1.0,
    onStart,
    onEnd,
    onError
  });
};

/**
 * Speaks an individual past test record for a cow
 */
export const speakCowHistoryRecord = ({
  cowName,
  rfid,
  record,
  language = 'en',
  onStart,
  onEnd,
  onError
}) => {
  const isHindi = language === 'hi';
  const { spokenName } = cleanCowSpeechIdentity(cowName, rfid, isHindi);
  const formattedDate = formatSpokenDate(record?.timestamp, isHindi);
  const stage = record?.predicted_stage || 'Healthy';

  let text = '';
  const langCode = isHindi ? 'hi-IN' : 'en-US';

  if (isHindi) {
    if (stage === 'Healthy') {
      text = `गाय ${spokenName}, ${formattedDate} की जांच: थन स्वस्थ था और दूध पूरी तरह सुरक्षित था।`;
    } else if (stage === 'Subclinical') {
      text = `गाय ${spokenName}, ${formattedDate} की जांच: हल्का थनैल संक्रमण मिला था। सोमैटिक सेल बढ़े हुए थे।`;
    } else {
      text = `गाय ${spokenName}, ${formattedDate} की जांच: गंभीर थनैल रोग दर्ज किया गया था। तुरंत उपचार की सलाह दी गई थी।`;
    }
  } else {
    if (stage === 'Healthy') {
      text = `Record for Cow ${spokenName} on ${formattedDate}. Result: Healthy udder, safe milk.`;
    } else if (stage === 'Subclinical') {
      text = `Record for Cow ${spokenName} on ${formattedDate}. Caution: Mild mastitis infection was detected.`;
    } else {
      text = `Record for Cow ${spokenName} on ${formattedDate}. Urgent: Clinical mastitis was detected.`;
    }
  }

  speakFluentText({
    text,
    lang: langCode,
    rate: isHindi ? 0.86 : 0.90,
    pitch: 1.0,
    onStart,
    onEnd,
    onError
  });
};

/**
 * Speaks a comprehensive health summary for the cow profile card
 */
export const speakCowProfileSummary = ({
  cow,
  language = 'en',
  onStart,
  onEnd,
  onError
}) => {
  if (!cow) return;
  const isHindi = language === 'hi';
  const { spokenName, tagShort } = cleanCowSpeechIdentity(cow.name, cow.rfid, isHindi);
  const breed = cow.breed || (isHindi ? 'देशी' : 'Indigenous');
  const count = cow.test_count || (cow.predictions ? cow.predictions.length : 0);
  const stage = cow.last_stage || 'Healthy';

  let text = '';
  const langCode = isHindi ? 'hi-IN' : 'en-US';

  if (isHindi) {
    let stageDesc = 'स्वस्थ थन';
    if (stage === 'Subclinical') stageDesc = 'हल्का थनैल संक्रमण';
    if (stage === 'Clinical') stageDesc = 'गंभीर थनैल रोग';

    text = `गाय ${spokenName}, नस्ल ${breed}। कुल ${count} जांच रिकॉर्ड दर्ज हैं। नवीनतम स्थिति: ${stageDesc}।`;
  } else {
    let stageDesc = 'Healthy';
    if (stage === 'Subclinical') stageDesc = 'Subclinical mastitis';
    if (stage === 'Clinical') stageDesc = 'Clinical mastitis';

    text = `Profile for Cow ${spokenName}, breed ${breed}, Tag ${tagShort}. Total ${count} health records on file. Latest status: ${stageDesc}.`;
  }

  speakFluentText({
    text,
    lang: langCode,
    rate: isHindi ? 0.86 : 0.90,
    pitch: 1.0,
    onStart,
    onEnd,
    onError
  });
};

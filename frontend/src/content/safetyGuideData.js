// Safety Guide content — pure data, no JSX, no network.
// This module ships inside the app bundle so the guide is readable with no
// connectivity and no server round-trip.

export const GUIDE_VERSION = '1.1.0';

// Public emergency numbers for India. Static reference data, not device data.
export const EMERGENCY_NUMBERS = [
  { label: 'All-in-one emergency', number: '112' },
  { label: 'Police', number: '100' },
  { label: 'Fire', number: '101' },
  { label: 'Ambulance', number: '108' },
  { label: 'Women helpline', number: '1091' },
  { label: 'Child helpline', number: '1098' },
  { label: 'Road accident emergency', number: '1073' },
];

export const CATEGORIES = [
  {
    id: 'personal-safety',
    title: 'Personal Safety',
    iconId: 'shield',
    questions: [
      {
        q: 'How do I stay safe while walking alone at night?',
        a: 'Stay in well-lit areas. Keep your phone charged and accessible. Share your live location with a trusted contact using Walk Me Home. Avoid wearing headphones in both ears. Walk confidently and be aware of your surroundings.',
      },
      {
        q: 'What should I do if someone is following me?',
        a: 'Move to a populated, well-lit area. Enter a nearby shop or public building. Call a trusted contact and keep them on the line. If you feel threatened, activate SOS. Do not go home if you believe someone is following you there.',
      },
      {
        q: 'How can I prepare for emergencies?',
        a: 'Set up your Trusted Contacts. Enable Walk Me Home for regular routes. Keep your phone charged. Save local emergency numbers. Practice using the SOS feature. Keep a power bank with you.',
      },
    ],
  },
  {
    id: 'public-transport',
    title: 'Public Transport Safety',
    iconId: 'route',
    questions: [
      {
        q: 'How do I stay safe on public transport?',
        a: 'Wait in designated, well-lit areas. Sit near the driver or in crowded carriages. Keep valuables hidden and bags zipped. Be cautious when using headphones. Share your trip with a trusted contact.',
      },
      {
        q: 'What if I feel unsafe on a bus or train?',
        a: 'Move to a different carriage or sit near other passengers. Press the emergency alarm if available. Call a trusted contact and stay on the line. Get off at the next stop if you feel threatened.',
      },
    ],
  },
  {
    id: 'harassment-response',
    title: 'Harassment Response',
    iconId: 'warning',
    questions: [
      {
        q: 'What should I do if I experience harassment?',
        a: 'Move to a safe, populated area immediately. Speak loudly to attract attention. Report to authorities or transport staff. Contact a trusted contact. Document details if safe to do so. Your safety is the priority.',
      },
      {
        q: 'How can I document an incident safely?',
        a: 'Only document if you are in a safe location. Note the time, location, and description. Take photos or video only if it does not put you at risk. Report to authorities. Seek support from trusted contacts.',
      },
    ],
  },
  {
    id: 'emergency-prep',
    title: 'Emergency Preparation',
    iconId: 'bolt',
    questions: [
      {
        q: 'How do I use the SOS feature?',
        a: 'Press and hold the SOS button for 3 seconds. Your location will be captured and an emergency event will be recorded. Your trusted contacts will be notified once delivery is configured. You can cancel within the countdown period.',
      },
      {
        q: 'What is Walk Me Home?',
        a: 'Walk Me Home lets you set a destination and expected arrival time. Start a session before your journey. Confirm your arrival when you reach safely. Your contacts can monitor your trip status.',
      },
      {
        q: 'What happens if I activate SOS without internet?',
        a: 'The event is written to this device first and queued. When connectivity returns the queue is replayed to the server. Until the server confirms it, the app shows the event as locally recorded rather than delivered.',
      },
    ],
  },
  {
    id: 'digital-privacy',
    title: 'Digital Privacy',
    iconId: 'lock',
    questions: [
      {
        q: 'How is my location data protected?',
        a: 'Your location is shared only with trusted contacts you designate during active SOS or safety sessions. Location data is transmitted over secure connections. You can stop sharing at any time by ending the session.',
      },
      {
        q: 'Can I use KAVACH offline?',
        a: 'Yes. Safety sessions and SOS events are recorded locally first. They sync to the server when connectivity is restored. You can view cached contacts and safety guidance offline.',
      },
      {
        q: 'Does KAVACH work when the app is closed?',
        a: 'No. Background SOS, shake detection and geofence checks require a separate native implementation and are not active. KAVACH only triggers while the app is open in the foreground.',
      },
    ],
  },
  {
    id: 'emergency-contacts',
    title: 'Emergency Numbers',
    iconId: 'phone',
    questions: [
      {
        q: 'Which emergency numbers should I know?',
        a: 'Dial 112 for the all-in-one emergency service in India. Police: 100. Fire: 101. Ambulance: 108. Women helpline: 1091. Child helpline: 1098. Save these before you travel.',
      },
      {
        q: 'What if I cannot speak during an emergency?',
        a: 'Call and stay on the line even if silent — operators can often trace the call. Use the KAVACH SOS button to record an emergency event and your location for your trusted contacts.',
      },
    ],
  },
];

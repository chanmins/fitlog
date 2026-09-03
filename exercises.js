/* FITLOG — Exercise Library */

const MUSCLE_GROUPS = {
  chest:      '가슴',
  pecs_minor: '소흉근',
  shoulders:  '어깨',
  levator:    '견갑거근',
  rhomboids:  '능형근',
  hip_flexor: '장요근',
  quads_rf:   '대퇴직근',
  adductors:  '내전근',
  chest_wall: '흉추',
  triceps:    '삼두근',
  biceps:     '이두근',
  back:       '등',
  lats:       '광배근',
  traps:      '승모근',
  abs:        '복근',
  lower_back: '허리',
  quads:      '대퇴사두',
  hamstrings: '햄스트링',
  glutes:     '둔근',
  calves:     '종아리',
};

const PARTS = [
  { id: 'chest',     label: '가슴',  color: '#ff6b81', kind: 'weight' },
  { id: 'back',      label: '등',    color: '#54a0ff', kind: 'weight' },
  { id: 'shoulders', label: '어깨',  color: '#ffa502', kind: 'weight' },
  { id: 'arms',      label: '팔',    color: '#a29bfe', kind: 'weight' },
  { id: 'legs',      label: '하체',  color: '#6bcb77', kind: 'weight' },
  { id: 'core',      label: '코어',  color: '#ffd43b', kind: 'weight' },
  { id: 'stretch',   label: '스트레칭', color: '#7ec8e3', kind: 'weight' },
  { id: 'run',       label: '러닝',  color: '#4ecdc4', kind: 'run'    },
];

/* Part color lookup helper */
function partColor(partId) {
  const p = PARTS.find(x => x.id === partId);
  return p ? p.color : '#8b8da8';
}

const DEFAULT_EXERCISES = {
  chest: [
    {
      id: 'bench-press',
      name: '벤치프레스',
      nameEn: 'Bench Press',
      equipment: 'barbell',
      difficulty: 2,
      primary:   ['chest'],
      secondary: ['shoulders', 'triceps'],
      description: '바벨을 이용한 가슴 운동의 왕. 가슴·어깨·삼두를 동시에 자극하는 상체 복합 운동의 기본입니다.',
      tips: [
        '발을 바닥에 단단히 붙이고 등을 약간 아치형으로 만드세요',
        '그립은 어깨 너비의 1.5배로 잡으세요',
        '바벨을 유두 높이(가슴 하부)로 내리세요',
        '팔꿈치는 몸통에서 약 75° 각도를 유지하세요',
        '밀어올릴 때 가슴 근육이 수축되는 것을 느껴보세요',
      ],
    },
    {
      id: 'incline-press',
      name: '인클라인 프레스',
      nameEn: 'Incline Bench Press',
      equipment: 'barbell',
      difficulty: 2,
      primary:   ['chest'],
      secondary: ['shoulders', 'triceps'],
      description: '30~45° 인클라인 벤치에서 수행하는 상부 가슴 집중 운동입니다. 가슴 상부 볼륨을 키웁니다.',
      tips: [
        '벤치 각도는 30~45°가 이상적, 그 이상이면 어깨 운동이 됩니다',
        '바벨을 쇄골 아래쪽으로 내리세요',
        '상부 가슴에 집중하며 천천히 밀어올리세요',
      ],
    },
    {
      id: 'dumbbell-fly',
      name: '덤벨 플라이',
      nameEn: 'Dumbbell Fly',
      equipment: 'dumbbell',
      difficulty: 1,
      primary:   ['chest'],
      secondary: ['shoulders'],
      description: '가슴 근육의 스트레칭과 수축에 집중하는 고립 운동. 가슴 안쪽 선을 또렷하게 만드는 데 효과적입니다.',
      tips: [
        '팔꿈치를 살짝 구부린 채 동작 내내 유지하세요',
        '최대로 내릴 때 가슴 스트레칭을 충분히 느껴보세요',
        '무게보다 근육 연결(마인드-머슬 커넥션)에 집중하세요',
      ],
    },
    {
      id: 'dips',
      name: '딥스',
      nameEn: 'Dips',
      equipment: 'bodyweight',
      difficulty: 2,
      primary:   ['chest'],
      secondary: ['triceps', 'shoulders'],
      description: '자신의 체중을 이용하는 상체 복합 운동. 상체를 앞으로 기울수록 가슴에, 수직에 가까울수록 삼두에 집중됩니다.',
      tips: [
        '가슴 자극을 원하면 상체를 약간 앞으로 기울이세요',
        '내려갈 때 어깨 앞쪽에 과도한 통증이 느껴지면 즉시 멈추세요',
        '완전히 올라올 때 팔꿈치를 끝까지 잠그지 않아도 됩니다',
      ],
    },
    {
      id: 'cable-crossover',
      name: '케이블 크로스오버',
      nameEn: 'Cable Crossover',
      equipment: 'cable',
      difficulty: 1,
      primary:   ['chest'],
      secondary: ['shoulders'],
      description: '케이블로 가슴 안쪽과 하부 선을 강조하는 고립 운동. 피니셔로 사용하면 효과적입니다.',
      tips: [
        '양 케이블을 허리 아래에서 교차시키며 끌어당기세요',
        '동작 내내 팔꿈치를 약간 구부린 상태를 유지하세요',
        '빠른 동작보다 천천히 쥐어짜는 것이 효과적입니다',
      ],
    },
  ],

  back: [
    {
      id: 'deadlift',
      name: '데드리프트',
      nameEn: 'Deadlift',
      equipment: 'barbell',
      difficulty: 3,
      primary:   ['back', 'lats', 'lower_back'],
      secondary: ['glutes', 'hamstrings', 'traps'],
      description: '바닥의 바벨을 허리 높이까지 들어올리는 전신 운동의 왕. 등, 엉덩이, 허벅지 뒷면을 동시에 자극합니다.',
      tips: [
        '허리를 항상 평평하게(중립)로 유지하는 것이 최우선입니다',
        '바벨은 항상 다리 가까이(정강이를 스치듯)에 위치시키세요',
        '엉덩이로 밀고 등으로 당기는 느낌으로 수행하세요',
        '견갑골을 모아 등을 긴장시킨 상태에서 시작하세요',
      ],
    },
    {
      id: 'lat-pulldown',
      name: '랫풀다운',
      nameEn: 'Lat Pulldown',
      equipment: 'cable',
      difficulty: 1,
      primary:   ['lats'],
      secondary: ['biceps', 'traps'],
      description: '광배근 발달에 최적화된 케이블 운동. 풀업이 어렵다면 이 운동으로 기초를 다지세요.',
      tips: [
        '가슴을 세우고 살짝 뒤로 기울이며 당기세요',
        '어깨를 귀에서 멀리 내리는 느낌으로 시작하세요',
        '바를 가슴 상부까지 당기고 잠시 수축을 유지하세요',
        '손목이 아니라 팔꿈치로 당기는 것을 상상하세요',
      ],
    },
    {
      id: 'seated-row',
      name: '시티드 로우',
      nameEn: 'Seated Cable Row',
      equipment: 'cable',
      difficulty: 1,
      primary:   ['back', 'lats'],
      secondary: ['biceps', 'traps'],
      description: '앉아서 수행하는 등 두께 발달 운동. 광배근 하부와 등 중앙을 집중 공략합니다.',
      tips: [
        '당길 때 팔꿈치를 몸통 뒤로 최대한 보내세요',
        '수축 포지션에서 견갑골을 쥐어짜세요',
        '상체가 뒤로 크게 젖혀지지 않도록 주의하세요',
      ],
    },
    {
      id: 'barbell-row',
      name: '바벨 로우',
      nameEn: 'Barbell Row',
      equipment: 'barbell',
      difficulty: 2,
      primary:   ['back', 'lats'],
      secondary: ['biceps', 'traps', 'lower_back'],
      description: '상체를 앞으로 기울인 채 바벨을 당기는 등 두께 발달의 핵심 운동입니다.',
      tips: [
        '허리 각도는 45~60°를 유지하세요',
        '배꼽 쪽으로 당겨 등 하부를 자극하세요',
        '허리를 항상 평평하게 유지하세요',
        '팔꿈치를 몸통 가까이 붙여 광배근을 더 자극하세요',
      ],
    },
    {
      id: 'pull-up',
      name: '풀업',
      nameEn: 'Pull-up',
      equipment: 'bodyweight',
      difficulty: 3,
      primary:   ['lats'],
      secondary: ['biceps', 'traps'],
      description: '철봉에 매달려 몸을 끌어올리는 광배근 최고의 운동. 상체 당기기 운동의 정점입니다.',
      tips: [
        '그립은 어깨 너비보다 약간 넓게 잡으세요',
        '어깨를 귀에서 멀리 내리는 것부터 시작하세요',
        '가슴을 철봉 쪽으로 당기며 올라오세요',
        '몸을 흔드는 반동 없이 천천히 수행하세요',
      ],
    },
  ],

  shoulders: [
    {
      id: 'ohp',
      name: '오버헤드 프레스',
      nameEn: 'Overhead Press',
      equipment: 'barbell',
      difficulty: 3,
      primary:   ['shoulders'],
      secondary: ['triceps', 'traps'],
      description: '서서 바벨을 머리 위로 밀어올리는 어깨 대표 복합 운동. 어깨 전체와 코어를 단련합니다.',
      tips: [
        '그립은 어깨 너비와 같거나 약간 넓게 잡으세요',
        '바벨이 이마 앞을 지날 때 머리를 약간 뒤로 피하세요',
        '올라가면 머리를 앞으로 내밀어 바와 수직선을 만드세요',
        '코어를 단단히 조여 허리가 과하게 구부러지지 않도록 하세요',
      ],
    },
    {
      id: 'lateral-raise',
      name: '레터럴 레이즈',
      nameEn: 'Lateral Raise',
      equipment: 'dumbbell',
      difficulty: 1,
      primary:   ['shoulders'],
      secondary: [],
      description: '덤벨을 옆으로 들어올려 중삼각근을 발달시키는 고립 운동. 어깨를 넓어 보이게 합니다.',
      tips: [
        '팔꿈치를 손보다 살짝 높게 유지하며 올리세요',
        '새끼손가락 쪽이 더 높은 느낌으로 올리세요',
        '어깨 높이까지만 올려도 충분합니다',
        '무거운 무게보다 가벼운 무게로 정확한 자세가 중요합니다',
      ],
    },
    {
      id: 'rear-delt-fly',
      name: '리어 델트 플라이',
      nameEn: 'Rear Delt Fly',
      equipment: 'dumbbell',
      difficulty: 1,
      primary:   ['shoulders'],
      secondary: ['traps', 'back'],
      description: '후면 삼각근 집중 운동. 구부러진 어깨 교정과 균형 잡힌 어깨 발달에 필수입니다.',
      tips: [
        '상체를 90° 가까이 숙이거나 인클라인 벤치에 엎드려 수행하세요',
        '팔꿈치를 살짝 구부린 채 양옆으로 최대한 벌리세요',
        '어깨 후면 근육이 수축하는 것을 느껴보세요',
      ],
    },
    {
      id: 'front-raise',
      name: '프론트 레이즈',
      nameEn: 'Front Raise',
      equipment: 'dumbbell',
      difficulty: 1,
      primary:   ['shoulders'],
      secondary: [],
      description: '덤벨을 앞으로 들어올려 전면 삼각근을 집중 자극하는 고립 운동입니다.',
      tips: [
        '어깨 높이까지만 올리세요',
        '몸을 흔들어 반동을 쓰지 않도록 주의하세요',
        '한 팔씩 교대로 또는 양팔 동시에 수행할 수 있습니다',
      ],
    },
  ],

  arms: [
    {
      id: 'barbell-curl',
      name: '바벨 컬',
      nameEn: 'Barbell Curl',
      equipment: 'barbell',
      difficulty: 1,
      primary:   ['biceps'],
      secondary: [],
      description: '바벨을 이용한 이두근 기본 운동. 이두근 전체 볼륨을 키우는 데 가장 효과적입니다.',
      tips: [
        '팔꿈치는 몸통 옆에 완전히 고정하세요',
        '반동을 쓰지 않고 이두에만 집중하세요',
        '최상단에서 이두를 한 번 쥐어짜세요',
        '내릴 때도 천천히 제어하며 내리세요',
      ],
    },
    {
      id: 'hammer-curl',
      name: '해머 컬',
      nameEn: 'Hammer Curl',
      equipment: 'dumbbell',
      difficulty: 1,
      primary:   ['biceps'],
      secondary: [],
      description: '덤벨을 세워서 컬하는 운동. 이두근 외측(장두)과 전완근(상완근)을 발달시킵니다.',
      tips: [
        '엄지손가락이 위를 향하게 덤벨을 세워 잡으세요',
        '팔꿈치를 고정하고 전완만 움직이세요',
        '교번으로 또는 동시에 수행 가능합니다',
      ],
    },
    {
      id: 'preacher-curl',
      name: '프리처 컬',
      nameEn: 'Preacher Curl',
      equipment: 'barbell',
      difficulty: 1,
      primary:   ['biceps'],
      secondary: [],
      description: '프리처 벤치를 이용해 이두근을 완전히 고립시키는 운동. 반동을 완전히 제거합니다.',
      tips: [
        '팔 뒤쪽이 패드에 완전히 밀착되게 하세요',
        '내려갈 때 천천히 제어하며 내리세요',
        '최상단에서 이두를 한 번 더 수축시키세요',
      ],
    },
    {
      id: 'tricep-pushdown',
      name: '푸시다운',
      nameEn: 'Triceps Pushdown',
      equipment: 'cable',
      difficulty: 1,
      primary:   ['triceps'],
      secondary: [],
      description: '케이블을 이용한 삼두근 기본 운동. 삼두근 외측 발달에 효과적이며 초보자에게도 적합합니다.',
      tips: [
        '팔꿈치를 몸통 옆에 고정하세요',
        '최하단에서 삼두를 꽉 쥐어짜세요',
        '위로 올라올 때도 삼두에 긴장을 유지하세요',
        '상체를 앞으로 과하게 기울이지 마세요',
      ],
    },
    {
      id: 'skull-crusher',
      name: '스컬크러셔',
      nameEn: 'Skull Crusher',
      equipment: 'barbell',
      difficulty: 2,
      primary:   ['triceps'],
      secondary: [],
      description: '누워서 바벨을 이마 위로 내렸다 올리는 삼두근 장두 집중 고립 운동입니다.',
      tips: [
        '팔꿈치를 어깨 너비로 고정하세요',
        '바벨은 이마보다 머리 뒤쪽으로 내리세요',
        '팔꿈치가 바깥으로 벌어지지 않도록 주의하세요',
      ],
    },
    {
      id: 'overhead-tricep-ext',
      name: '오버헤드 삼두 익스텐션',
      nameEn: 'Overhead Triceps Extension',
      equipment: 'dumbbell',
      difficulty: 1,
      primary:   ['triceps'],
      secondary: [],
      description: '덤벨을 머리 위로 들어 뒤로 내렸다 올리는 삼두근 장두 강조 운동입니다.',
      tips: [
        '팔꿈치를 최대한 귀 가까이 고정하세요',
        '팔꿈치만 움직이고 상완은 고정하세요',
        '천천히 내려 삼두를 충분히 스트레칭하세요',
      ],
    },
  ],

  legs: [
    {
      id: 'squat',
      name: '스쿼트',
      nameEn: 'Back Squat',
      equipment: 'barbell',
      difficulty: 3,
      primary:   ['quads', 'glutes'],
      secondary: ['hamstrings', 'lower_back'],
      description: '바벨을 등에 지고 앉았다 일어나는 하체 운동의 왕. 하체 전체와 코어를 동시에 단련합니다.',
      tips: [
        '발은 어깨 너비로 벌리고 발끝은 15~30° 바깥으로 향하게 하세요',
        '가슴을 세우고 허리는 중립을 유지하세요',
        '무릎이 발끝 방향을 따라가도록 하세요',
        '허벅지가 바닥과 평행이 될 때까지 앉으세요',
        '발뒤꿈치로 바닥을 밀며 일어서세요',
      ],
    },
    {
      id: 'leg-press',
      name: '레그프레스',
      nameEn: 'Leg Press',
      equipment: 'machine',
      difficulty: 1,
      primary:   ['quads'],
      secondary: ['glutes', 'hamstrings'],
      description: '머신을 이용한 하체 운동. 허리 부담 없이 대퇴사두에 집중할 수 있어 초보자에게도 적합합니다.',
      tips: [
        '발 위치가 높을수록 햄스트링·둔근에, 낮을수록 대퇴사두에 집중됩니다',
        '무릎이 안쪽으로 모이지 않도록 주의하세요',
        '완전히 펼 때 무릎을 잠그지 마세요',
      ],
    },
    {
      id: 'rdl',
      name: '루마니안 데드리프트',
      nameEn: 'Romanian Deadlift',
      equipment: 'barbell',
      difficulty: 2,
      primary:   ['hamstrings', 'glutes'],
      secondary: ['lower_back', 'back'],
      description: '햄스트링과 둔근을 집중 자극하는 힌지 패턴 운동. 무릎을 거의 구부리지 않고 수행합니다.',
      tips: [
        '고관절을 뒤로 밀면서 상체를 숙이는 느낌으로 수행하세요',
        '허리는 항상 평평하게, 등이 둥글어지지 않도록 주의하세요',
        '햄스트링의 강한 스트레칭이 느껴지면 멈추고 올라오세요',
      ],
    },
    {
      id: 'leg-curl',
      name: '레그 컬',
      nameEn: 'Leg Curl',
      equipment: 'machine',
      difficulty: 1,
      primary:   ['hamstrings'],
      secondary: [],
      description: '머신을 이용한 햄스트링 고립 운동. 누워서 또는 앉아서 수행합니다.',
      tips: [
        '발등을 당겨 발목을 구부린 채 수행하면 더 효과적입니다',
        '최대 수축 지점에서 잠깐 유지하세요',
        '반동 없이 천천히 내리세요',
      ],
    },
    {
      id: 'leg-extension',
      name: '레그 익스텐션',
      nameEn: 'Leg Extension',
      equipment: 'machine',
      difficulty: 1,
      primary:   ['quads'],
      secondary: [],
      description: '대퇴사두를 고립시키는 머신 운동. 완전히 펼 때 짧은 유지로 효과가 극대화됩니다.',
      tips: [
        '완전히 펼 때 대퇴사두를 쥐어짜세요',
        '천천히 내려 근육에 긴장을 유지하세요',
        '무릎 통증이 있으면 가동 범위를 줄이세요',
      ],
    },
    {
      id: 'hip-thrust',
      name: '힙 스러스트',
      nameEn: 'Hip Thrust',
      equipment: 'barbell',
      difficulty: 2,
      primary:   ['glutes'],
      secondary: ['hamstrings'],
      description: '벤치에 등을 기대고 고관절을 신전시키는 둔근 집중 운동입니다. 최고의 둔근 운동 중 하나입니다.',
      tips: [
        '턱을 가슴 쪽으로 당겨 목이 꺾이지 않게 하세요',
        '최상단에서 둔근을 꽉 쥐어짜며 1~2초 유지하세요',
        '발뒤꿈치로 바닥을 밀어야 햄보다 둔근에 집중됩니다',
      ],
    },
    {
      id: 'calf-raise',
      name: '카프레이즈',
      nameEn: 'Calf Raise',
      equipment: 'machine',
      difficulty: 1,
      primary:   ['calves'],
      secondary: [],
      description: '종아리 근육(비복근, 가자미근)을 발달시키는 기본 운동입니다.',
      tips: [
        '최대로 올라가 뒤꿈치를 높이 들어올리세요',
        '내릴 때는 뒤꿈치가 스텝 아래까지 내려가게 하세요',
        '천천히 내려 스트레칭을 충분히 하세요',
      ],
    },
  ],

  core: [
    {
      id: 'plank',
      name: '플랭크',
      nameEn: 'Plank',
      equipment: 'bodyweight',
      difficulty: 1,
      primary:   ['abs', 'lower_back'],
      secondary: ['shoulders', 'glutes'],
      description: '전신 코어를 등척성으로 단련하는 기본 운동. 복근뿐만 아니라 허리 안정화에도 매우 중요합니다.',
      tips: [
        '몸이 일직선이 되도록 하세요. 엉덩이가 처지거나 올라가면 안 됩니다',
        '복부를 당기고 둔근을 조이세요',
        '호흡을 유지하세요, 숨을 참지 마세요',
        '처음엔 30초부터 시작해 점차 늘려가세요',
      ],
    },
    {
      id: 'crunch',
      name: '크런치',
      nameEn: 'Crunch',
      equipment: 'bodyweight',
      difficulty: 1,
      primary:   ['abs'],
      secondary: [],
      description: '복직근(6팩 근육)을 집중적으로 단련하는 기본 코어 운동입니다.',
      tips: [
        '손은 귀 옆에 가볍게 대세요, 목을 당기지 마세요',
        '머리가 아닌 복근으로 몸을 올리세요',
        '천천히 내려오며 근육 긴장을 유지하세요',
      ],
    },
    {
      id: 'hanging-leg-raise',
      name: '행잉 레그레이즈',
      nameEn: 'Hanging Leg Raise',
      equipment: 'bodyweight',
      difficulty: 3,
      primary:   ['abs'],
      secondary: ['lower_back'],
      description: '철봉에 매달려 다리를 올리는 하복부 강화 운동. 복근 하부를 집중 자극합니다.',
      tips: [
        '반동 없이 천천히 다리를 올리세요',
        '배꼽을 당기는 느낌으로 수행하세요',
        '처음엔 무릎을 구부려 수행하다가 점차 다리를 펴세요',
      ],
    },
    {
      id: 'russian-twist',
      name: '러시안 트위스트',
      nameEn: 'Russian Twist',
      equipment: 'bodyweight',
      difficulty: 1,
      primary:   ['abs'],
      secondary: ['lower_back'],
      description: '앉아서 상체를 좌우로 돌리는 복사근(옆 복근) 운동입니다.',
      tips: [
        '발을 바닥에서 약간 들어 난이도를 높일 수 있습니다',
        '메디신볼이나 덤벨을 추가해 강도를 높이세요',
        '허리 통증이 있다면 발을 바닥에 내려놓고 수행하세요',
      ],
    },
    {
      id: 'ab-wheel',
      name: '복근 롤아웃',
      nameEn: 'Ab Wheel Rollout',
      equipment: 'other',
      difficulty: 3,
      primary:   ['abs', 'lower_back'],
      secondary: ['shoulders', 'lats'],
      description: '복근 롤러를 이용한 고강도 코어 운동. 복근 전체와 허리 안정화에 매우 효과적입니다.',
      tips: [
        '처음엔 무릎을 바닥에 대고 수행하세요',
        '허리가 꺾이지 않도록 코어에 힘을 주세요',
        '복근이 지쳐서 내려가기 시작하면 즉시 멈추세요',
      ],
    },
  ],
};

/* Find exercise by id or name across all parts */
function findExercise(idOrName) {
  if (!idOrName) return null;
  for (const list of Object.values(DEFAULT_EXERCISES)) {
    const found = list.find(e => e.id === idOrName || e.name === idOrName);
    if (found) return found;
  }
  return null;
}

/* EQUIPMENT labels */
const EQUIPMENT_LABEL = {
  barbell:    '바벨',
  dumbbell:   '덤벨',
  cable:      '케이블',
  machine:    '머신',
  bodyweight: '맨몸',
  other:      '기타',
};

const DIFFICULTY_LABEL = ['', '초급', '중급', '고급'];

/* ============================================================
   추가 운동 라이브러리
   위 DEFAULT_EXERCISES 에 부위별로 덧붙입니다. 기존 항목은 그대로 두고
   여기에만 추가하면 되므로, 나중에 운동을 더 넣기도 쉽습니다.
   ============================================================ */
const EXTRA_EXERCISES = {
  chest: [
    { id:'db-bench-press', name:'덤벨 벤치프레스', nameEn:'Dumbbell Bench Press', equipment:'dumbbell', difficulty:1,
      primary:['chest'], secondary:['shoulders','triceps'],
      description:'바벨보다 가동 범위가 넓어 가슴을 더 깊게 늘렸다 모을 수 있습니다. 좌우 균형을 잡는 데도 좋습니다.',
      tips:['덤벨을 가슴 옆까지 충분히 내리세요','맨 위에서 덤벨끼리 부딪히지 않게 하세요'] },
    { id:'db-incline-press', name:'인클라인 덤벨 프레스', nameEn:'Incline Dumbbell Press', equipment:'dumbbell', difficulty:2,
      primary:['chest'], secondary:['shoulders','triceps'],
      description:'가슴 윗부분을 두껍게 만드는 대표 운동입니다.',
      tips:['벤치 각도는 30~45°가 적당합니다','팔꿈치를 너무 벌리지 마세요'] },
    { id:'decline-press', name:'디클라인 프레스', nameEn:'Decline Bench Press', equipment:'barbell', difficulty:2,
      primary:['chest'], secondary:['triceps'],
      description:'가슴 아랫부분과 가슴 선을 또렷하게 만드는 운동입니다.',
      tips:['다리를 단단히 고정하세요','내릴 때 명치 아래쪽을 향하게 하세요'] },
    { id:'machine-chest-press', name:'체스트 프레스 머신', nameEn:'Machine Chest Press', equipment:'machine', difficulty:1,
      primary:['chest'], secondary:['shoulders','triceps'],
      description:'궤도가 고정돼 있어 초보자도 안전하게 가슴을 자극할 수 있습니다.',
      tips:['손잡이가 가슴 높이에 오도록 의자를 맞추세요','끝까지 밀되 팔꿈치를 잠그지는 마세요'] },
    { id:'pec-deck', name:'펙덱 플라이', nameEn:'Pec Deck', equipment:'machine', difficulty:1,
      primary:['chest'], secondary:[],
      description:'가슴만 고립해서 모아주는 머신 운동입니다.',
      tips:['모은 상태에서 1초 멈추고 가슴을 쥐어짜세요','어깨가 앞으로 말리지 않게 하세요'] },
    { id:'push-up', name:'푸시업', nameEn:'Push Up', equipment:'bodyweight', difficulty:1,
      primary:['chest'], secondary:['triceps','shoulders','abs'],
      description:'장비 없이 어디서나 가능한 기본 가슴 운동입니다.',
      tips:['머리부터 발끝까지 일직선을 유지하세요','손은 어깨보다 살짝 넓게 짚으세요'] },
    { id:'incline-cable-fly', name:'인클라인 케이블 플라이', nameEn:'Incline Cable Fly', equipment:'cable', difficulty:2,
      primary:['chest'], secondary:['shoulders'],
      description:'케이블 장력이 계속 걸려 가슴 상부를 균일하게 자극합니다.',
      tips:['아래에서 위로 모아 올리세요','팔꿈치 각도를 고정한 채 움직이세요'] },
    { id:'svend-press', name:'플레이트 프레스', nameEn:'Svend Press', equipment:'other', difficulty:1,
      primary:['chest'], secondary:[],
      description:'원판을 가슴 앞에서 맞대고 밀어내며 가슴 안쪽을 자극합니다.',
      tips:['원판을 서로 강하게 밀착시킨 채 뻗으세요','무게보다 수축감에 집중하세요'] },
  ],

  back: [
    { id:'t-bar-row', name:'티바 로우', nameEn:'T-Bar Row', equipment:'barbell', difficulty:2,
      primary:['back','lats'], secondary:['biceps','traps'],
      description:'등 중앙을 두껍게 만드는 데 효과적인 로우 변형입니다.',
      tips:['가슴을 편 채 상체 각도를 유지하세요','배꼽 쪽으로 당기세요'] },
    { id:'one-arm-db-row', name:'원암 덤벨 로우', nameEn:'One-Arm Dumbbell Row', equipment:'dumbbell', difficulty:1,
      primary:['lats'], secondary:['back','biceps'],
      description:'한쪽씩 집중해 광배근을 크게 늘렸다 당길 수 있습니다.',
      tips:['허리가 돌아가지 않게 고정하세요','팔꿈치를 몸통에 붙여 뒤로 당기세요'] },
    { id:'chin-up', name:'친업', nameEn:'Chin Up', equipment:'bodyweight', difficulty:2,
      primary:['lats'], secondary:['biceps','back'],
      description:'손바닥이 몸 쪽을 향하는 그립의 턱걸이로, 이두 개입이 커집니다.',
      tips:['어깨를 아래로 내리며 시작하세요','턱이 봉을 넘도록 당기세요'] },
    /* '케이블 시티드 로우'(cable-row)를 뺐습니다 — 위의 '시티드 로우'
       (seated-row, Seated Cable Row)와 같은 동작이었습니다. 영문명이
       'Seated Cable Row' 와 'Cable Seated Row' 로 어순만 달랐고, 동작
       그림(media/cable-row-*.svg)도 seated-row 것과 바이트까지 같은
       사본이었습니다. 목록에서 둘 중 어느 쪽을 골라야 하는지 알 수 없는
       항목이 나란히 있는 것이 라이브러리에서 가장 나쁜 상태입니다.
       설명과 팁이 더 충실한 seated-row 를 남겼습니다. */
    { id:'straight-arm-pulldown', name:'스트레이트 암 풀다운', nameEn:'Straight-Arm Pulldown', equipment:'cable', difficulty:1,
      primary:['lats'], secondary:[],
      description:'팔을 편 채 내려 광배근만 고립해 자극합니다.',
      tips:['팔꿈치를 거의 편 상태로 유지하세요','허벅지 앞까지 눌러 내리세요'] },
    { id:'face-pull', name:'페이스 풀', nameEn:'Face Pull', equipment:'cable', difficulty:1,
      primary:['traps'], secondary:['shoulders','back'],
      description:'뒤어깨와 승모근 중하부를 자극해 굽은 어깨 교정에 좋습니다.',
      tips:['얼굴 높이로 당기며 손등이 귀 옆에 오게 하세요','가볍게 여러 번 하는 편이 낫습니다'] },
    { id:'shrug', name:'슈러그', nameEn:'Shrug', equipment:'dumbbell', difficulty:1,
      primary:['traps'], secondary:[],
      description:'승모근 상부를 직접 키우는 운동입니다.',
      tips:['어깨를 귀 쪽으로 곧게 올리세요','돌리지 말고 위아래로만 움직이세요'] },
    { id:'good-morning', name:'굿모닝', nameEn:'Good Morning', equipment:'barbell', difficulty:3,
      primary:['lower_back'], secondary:['hamstrings','glutes'],
      description:'허리 기립근과 햄스트링을 함께 단련합니다. 가벼운 무게로 시작하세요.',
      tips:['무릎을 살짝 굽힌 채 엉덩이를 뒤로 빼세요','허리가 굽지 않게 반드시 편 상태를 유지하세요'] },
    { id:'back-extension', name:'백 익스텐션', nameEn:'Back Extension', equipment:'bodyweight', difficulty:1,
      primary:['lower_back'], secondary:['glutes','hamstrings'],
      description:'허리 기립근을 안전하게 강화하는 기본 운동입니다.',
      tips:['반동 없이 천천히 올라오세요','과하게 젖히지 마세요'] },
  ],

  shoulders: [
    { id:'db-shoulder-press', name:'덤벨 숄더프레스', nameEn:'Dumbbell Shoulder Press', equipment:'dumbbell', difficulty:1,
      primary:['shoulders'], secondary:['triceps'],
      description:'어깨 전체 볼륨을 키우는 기본 프레스입니다.',
      tips:['팔꿈치를 살짝 앞쪽에 두세요','허리가 젖혀지지 않게 배에 힘을 주세요'] },
    { id:'arnold-press', name:'아놀드 프레스', nameEn:'Arnold Press', equipment:'dumbbell', difficulty:2,
      primary:['shoulders'], secondary:['triceps'],
      description:'회전을 더해 앞·옆 어깨를 한 번에 자극합니다.',
      tips:['손바닥이 몸 쪽에서 시작해 바깥으로 돌리세요','천천히 회전시키세요'] },
    { id:'cable-lateral-raise', name:'케이블 레터럴 레이즈', nameEn:'Cable Lateral Raise', equipment:'cable', difficulty:2,
      primary:['shoulders'], secondary:[],
      description:'옆어깨에 장력이 끊기지 않아 모양을 만드는 데 좋습니다.',
      tips:['몸이 흔들리지 않게 고정하세요','어깨 높이까지만 올리세요'] },
    { id:'upright-row', name:'업라이트 로우', nameEn:'Upright Row', equipment:'barbell', difficulty:2,
      primary:['shoulders'], secondary:['traps','biceps'],
      description:'어깨와 승모근을 함께 자극합니다.',
      tips:['손 간격을 너무 좁게 잡지 마세요','가슴 높이 이상 올리지 마세요'] },
    { id:'machine-shoulder-press', name:'숄더프레스 머신', nameEn:'Machine Shoulder Press', equipment:'machine', difficulty:1,
      primary:['shoulders'], secondary:['triceps'],
      description:'궤도가 고정돼 무거운 무게도 안정적으로 다룰 수 있습니다.',
      tips:['손잡이가 어깨 높이에 오게 의자를 조절하세요'] },
    { id:'reverse-pec-deck', name:'리버스 펙덱', nameEn:'Reverse Pec Deck', equipment:'machine', difficulty:1,
      primary:['shoulders'], secondary:['traps','back'],
      description:'뒤어깨를 고립해서 자극하는 머신 운동입니다.',
      tips:['팔을 거의 편 채 뒤로 벌리세요','견갑골을 모으며 마무리하세요'] },
    { id:'landmine-press', name:'랜드마인 프레스', nameEn:'Landmine Press', equipment:'barbell', difficulty:2,
      primary:['shoulders'], secondary:['chest','triceps'],
      description:'어깨 부담이 적은 사선 방향 프레스입니다.',
      tips:['사선 위로 밀어내세요','한쪽씩 번갈아 수행하세요'] },
    { id:'pike-push-up', name:'파이크 푸시업', nameEn:'Pike Push Up', equipment:'bodyweight', difficulty:2,
      primary:['shoulders'], secondary:['triceps'],
      description:'맨몸으로 어깨를 집중 자극하는 푸시업 변형입니다.',
      tips:['엉덩이를 높이 들어 몸을 ㅅ자로 만드세요','정수리가 바닥을 향하게 내리세요'] },
  ],

  arms: [
    { id:'db-curl', name:'덤벨 컬', nameEn:'Dumbbell Curl', equipment:'dumbbell', difficulty:1,
      primary:['biceps'], secondary:[],
      description:'이두를 키우는 가장 기본적인 운동입니다.',
      tips:['팔꿈치를 옆구리에 고정하세요','반동을 쓰지 말고 천천히 내리세요'] },
    { id:'incline-db-curl', name:'인클라인 덤벨 컬', nameEn:'Incline Dumbbell Curl', equipment:'dumbbell', difficulty:2,
      primary:['biceps'], secondary:[],
      description:'팔을 뒤로 늘린 상태에서 시작해 이두 장두를 깊게 자극합니다.',
      tips:['등받이를 45~60°로 맞추세요','팔을 완전히 늘어뜨린 채 시작하세요'] },
    { id:'concentration-curl', name:'컨센트레이션 컬', nameEn:'Concentration Curl', equipment:'dumbbell', difficulty:1,
      primary:['biceps'], secondary:[],
      description:'팔꿈치를 허벅지에 고정해 이두 봉우리를 만듭니다.',
      tips:['상체를 흔들지 마세요','맨 위에서 1초 멈추세요'] },
    { id:'cable-curl', name:'케이블 컬', nameEn:'Cable Curl', equipment:'cable', difficulty:1,
      primary:['biceps'], secondary:[],
      description:'전 구간에 장력이 유지되는 이두 운동입니다.',
      tips:['팔꿈치 위치를 고정하세요','내릴 때 저항을 버티며 천천히'] },
    { id:'close-grip-bench', name:'클로즈그립 벤치프레스', nameEn:'Close-Grip Bench Press', equipment:'barbell', difficulty:2,
      primary:['triceps'], secondary:['chest','shoulders'],
      description:'무거운 무게로 삼두를 키울 수 있는 복합 운동입니다.',
      tips:['어깨 너비 정도로 잡으세요','팔꿈치를 몸통에 붙여 내리세요'] },
    { id:'dips-triceps', name:'삼두 딥스', nameEn:'Triceps Dips', equipment:'bodyweight', difficulty:2,
      primary:['triceps'], secondary:['chest','shoulders'],
      description:'상체를 세운 채 수행해 삼두에 집중하는 딥스입니다.',
      tips:['상체를 최대한 수직으로 유지하세요','팔꿈치가 벌어지지 않게 하세요'] },
    { id:'rope-pushdown', name:'로프 푸시다운', nameEn:'Rope Pushdown', equipment:'cable', difficulty:1,
      primary:['triceps'], secondary:[],
      description:'맨 아래에서 로프를 벌려 삼두 외측두를 강하게 수축시킵니다.',
      tips:['맨 아래에서 로프를 양옆으로 벌리세요','팔꿈치를 옆구리에 고정하세요'] },
    { id:'kickback', name:'킥백', nameEn:'Triceps Kickback', equipment:'dumbbell', difficulty:1,
      primary:['triceps'], secondary:[],
      description:'삼두를 완전히 수축시키는 고립 운동입니다.',
      tips:['상완을 바닥과 평행하게 고정하세요','끝에서 1초 멈추세요'] },
    { id:'reverse-curl', name:'리버스 컬', nameEn:'Reverse Curl', equipment:'barbell', difficulty:1,
      primary:['biceps'], secondary:[],
      description:'손등이 위를 향하는 그립으로 팔뚝과 이두 하부를 자극합니다.',
      tips:['손목을 고정한 채 들어올리세요','무게를 욕심내지 마세요'] },
    { id:'wrist-curl', name:'리스트 컬', nameEn:'Wrist Curl', equipment:'dumbbell', difficulty:1,
      primary:['biceps'], secondary:[],
      description:'전완근을 직접 단련해 그립 힘을 키웁니다.',
      tips:['손목만 움직이세요','가벼운 무게로 횟수를 많이 가져가세요'] },
  ],

  legs: [
    { id:'front-squat', name:'프론트 스쿼트', nameEn:'Front Squat', equipment:'barbell', difficulty:3,
      primary:['quads'], secondary:['glutes','abs'],
      description:'바벨을 앞쪽에 얹어 허벅지 앞면에 집중되는 스쿼트입니다.',
      tips:['팔꿈치를 높게 유지하세요','상체를 최대한 세우세요'] },
    { id:'bulgarian-split-squat', name:'불가리안 스플릿 스쿼트', nameEn:'Bulgarian Split Squat', equipment:'dumbbell', difficulty:2,
      primary:['quads','glutes'], secondary:['hamstrings'],
      description:'한 다리씩 수행해 좌우 불균형을 잡고 엉덩이·허벅지를 강하게 자극합니다.',
      tips:['뒷발을 벤치에 올리고 앞발에 체중을 실으세요','무릎이 안으로 모이지 않게 하세요'] },
    { id:'lunge', name:'런지', nameEn:'Lunge', equipment:'dumbbell', difficulty:1,
      primary:['quads','glutes'], secondary:['hamstrings'],
      description:'하체 전반을 고루 쓰는 기본 운동입니다.',
      tips:['앞무릎이 발끝을 넘지 않게 하세요','상체를 곧게 세우세요'] },
    { id:'hack-squat', name:'핵 스쿼트', nameEn:'Hack Squat', equipment:'machine', difficulty:2,
      primary:['quads'], secondary:['glutes'],
      description:'궤도가 고정돼 허벅지 앞면에 안전하게 고중량을 실을 수 있습니다.',
      tips:['발 위치를 발판 가운데에 두세요','무릎을 완전히 펴 잠그지 마세요'] },
    { id:'goblet-squat', name:'고블릿 스쿼트', nameEn:'Goblet Squat', equipment:'dumbbell', difficulty:1,
      primary:['quads','glutes'], secondary:['abs'],
      description:'덤벨을 가슴 앞에 들고 하는 스쿼트로, 자세를 익히기 좋습니다.',
      tips:['팔꿈치를 무릎 안쪽으로 내리세요','뒤꿈치로 밀어 올라오세요'] },
    { id:'stiff-leg-deadlift', name:'스티프 레그 데드리프트', nameEn:'Stiff-Leg Deadlift', equipment:'barbell', difficulty:2,
      primary:['hamstrings'], secondary:['glutes','lower_back'],
      description:'햄스트링을 길게 늘려 자극하는 데드리프트 변형입니다.',
      tips:['무릎을 거의 편 채 엉덩이를 뒤로 빼세요','허리를 굽히지 마세요'] },
    { id:'seated-leg-curl', name:'시티드 레그컬', nameEn:'Seated Leg Curl', equipment:'machine', difficulty:1,
      primary:['hamstrings'], secondary:[],
      description:'앉은 자세로 햄스트링을 고립해 자극합니다.',
      tips:['엉덩이가 들리지 않게 고정하세요','천천히 되돌리세요'] },
    { id:'glute-bridge', name:'글루트 브릿지', nameEn:'Glute Bridge', equipment:'bodyweight', difficulty:1,
      primary:['glutes'], secondary:['hamstrings'],
      description:'장비 없이 엉덩이를 자극하는 기본 운동입니다.',
      tips:['맨 위에서 엉덩이를 조여 1초 멈추세요','허리가 아닌 엉덩이로 밀어 올리세요'] },
    { id:'abduction', name:'힙 어브덕션', nameEn:'Hip Abduction', equipment:'machine', difficulty:1,
      primary:['glutes'], secondary:[],
      description:'엉덩이 옆쪽(중둔근)을 자극해 힙라인을 만듭니다.',
      tips:['상체를 살짝 앞으로 기울이면 자극이 커집니다','천천히 벌리고 천천히 모으세요'] },
    { id:'seated-calf-raise', name:'시티드 카프 레이즈', nameEn:'Seated Calf Raise', equipment:'machine', difficulty:1,
      primary:['calves'], secondary:[],
      description:'무릎을 굽힌 상태로 종아리 심부 근육을 자극합니다.',
      tips:['최대한 높이 올리고 끝까지 내리세요','반동 없이 천천히'] },
  ],

  core: [
    { id:'leg-raise', name:'레그 레이즈', nameEn:'Lying Leg Raise', equipment:'bodyweight', difficulty:1,
      primary:['abs'], secondary:['lower_back'],
      description:'누워서 다리를 들어 하복부를 자극합니다.',
      tips:['허리를 바닥에 붙인 채 유지하세요','내릴 때 발이 바닥에 닿지 않게 하세요'] },
    { id:'bicycle-crunch', name:'바이시클 크런치', nameEn:'Bicycle Crunch', equipment:'bodyweight', difficulty:1,
      primary:['abs'], secondary:[],
      description:'상복부와 옆구리를 동시에 자극하는 크런치 변형입니다.',
      tips:['팔꿈치와 반대쪽 무릎을 맞추세요','목을 당기지 말고 복근으로 올라오세요'] },
    { id:'side-plank', name:'사이드 플랭크', nameEn:'Side Plank', equipment:'bodyweight', difficulty:1,
      primary:['abs'], secondary:['lower_back'],
      description:'옆구리와 코어 안정성을 기르는 정적 운동입니다.',
      tips:['몸이 일직선이 되게 유지하세요','엉덩이가 처지지 않게 하세요'] },
    { id:'cable-crunch', name:'케이블 크런치', nameEn:'Cable Crunch', equipment:'cable', difficulty:2,
      primary:['abs'], secondary:[],
      description:'무게를 더해 복근을 근비대시킬 수 있는 운동입니다.',
      tips:['허리가 아닌 복근을 말아 내리세요','엉덩이 위치를 고정하세요'] },
    { id:'mountain-climber', name:'마운틴 클라이머', nameEn:'Mountain Climber', equipment:'bodyweight', difficulty:1,
      primary:['abs'], secondary:['shoulders','quads'],
      description:'코어와 심폐를 동시에 자극하는 유산소성 복근 운동입니다.',
      tips:['엉덩이가 위로 솟지 않게 하세요','속도보다 자세를 먼저 잡으세요'] },
    { id:'dead-bug', name:'데드버그', nameEn:'Dead Bug', equipment:'bodyweight', difficulty:1,
      primary:['abs'], secondary:['lower_back'],
      description:'허리에 부담 없이 코어 안정성을 기르는 운동입니다.',
      tips:['허리를 바닥에 붙인 채 유지하세요','반대쪽 팔·다리를 천천히 뻗으세요'] },
    { id:'hollow-hold', name:'할로우 홀드', nameEn:'Hollow Hold', equipment:'bodyweight', difficulty:2,
      primary:['abs'], secondary:[],
      description:'복근 전체에 지속적인 긴장을 주는 정적 운동입니다.',
      tips:['허리를 바닥에 밀착시키세요','버티기 힘들면 무릎을 굽히세요'] },
    { id:'woodchopper', name:'우드 초퍼', nameEn:'Cable Woodchopper', equipment:'cable', difficulty:2,
      primary:['abs'], secondary:['shoulders','lower_back'],
      description:'회전 동작으로 옆구리를 자극합니다.',
      tips:['팔이 아닌 몸통 회전으로 당기세요','시선은 손을 따라가세요'] },
  ],
};

/* ============================================================
   스트레칭 · 자세 교정
   ============================================================
   웨이트와 달리 무게가 없고 "몇 초 버텼는가"로 기록합니다. hold: true 가
   그 표시이고, 앱은 이 값을 보고 세트 줄에서 kg 칸을 빼고 단위를 초로
   바꿉니다.

   두 가지 자세 문제를 다룹니다. 둘 다 같은 구조 — 특정 근육이 짧아져
   당기고, 그 반대쪽이 약해져 못 버티는 것 — 이라서 늘리는 운동과
   강화하는 운동이 짝으로 들어갑니다. 늘리기만 해서는 원래대로 돌아옵니다.

   · 라운드숄더  짧아짐: 대흉근·소흉근·상부승모근·견갑거근
                 약해짐: 능형근·하부승모근
   · 골반 전방경사 짧아짐: 장요근·대퇴직근·척추기립근
                 약해짐: 둔근·복근

   시간은 정적 스트레칭의 통상 권장치인 30초를 기준으로 적었습니다. */
const STRETCH_EXERCISES = [
  /* ── 라운드숄더 ─────────────────────────────────────────── */
  { id:'st-doorway-pec', name:'도어웨이 가슴 스트레칭', nameEn:'Doorway Pec Stretch',
    equipment:'bodyweight', difficulty:1, hold:true,
    primary:['chest'], secondary:['shoulders'],
    description:'문틀에 팔을 대고 몸을 앞으로 보내 굳은 가슴을 엽니다. 라운드숄더에서 가장 먼저 풀어야 할 근육입니다.',
    tips:['팔꿈치를 어깨 높이로 두세요','허리를 젖히지 말고 가슴만 여세요',
          '팔 높이를 위·중간·아래로 바꾸면 가슴의 다른 부분이 늘어납니다','30초씩 좌우 2~3회'] },

  { id:'st-pec-minor', name:'소흉근 스트레칭', nameEn:'Pec Minor Stretch',
    equipment:'bodyweight', difficulty:1, hold:true,
    primary:['pecs_minor'], secondary:['chest'],
    description:'어깨를 앞으로 말아 내리는 소흉근을 늘립니다. 대흉근보다 깊이 있어 따로 풀어줘야 합니다.',
    tips:['벽 모서리에 팔을 대고 몸을 반대로 돌리세요','어깨가 위로 솟지 않게 내린 채 유지하세요',
          '통증이 아니라 당기는 느낌까지만','30초씩 좌우'] },

  { id:'st-upper-trap', name:'상부승모근 스트레칭', nameEn:'Upper Trapezius Stretch',
    equipment:'bodyweight', difficulty:1, hold:true,
    primary:['traps'], secondary:[],
    description:'목과 어깨 사이가 뻣뻣한 것을 풀어줍니다. 라운드숄더와 거북목에 함께 따라옵니다.',
    tips:['머리를 옆으로 기울이고 반대쪽 어깨를 아래로 누르세요','손으로 살짝 당기되 힘주지 마세요',
          '목을 돌리지 말고 옆으로만','30초씩 좌우'] },

  { id:'st-levator', name:'견갑거근 스트레칭', nameEn:'Levator Scapulae Stretch',
    equipment:'bodyweight', difficulty:1, hold:true,
    primary:['levator'], secondary:['traps'],
    description:'어깨뼈를 위로 끌어올리는 근육을 늘립니다. 상부승모근과 함께 풀어야 효과가 있습니다.',
    tips:['고개를 45도 옆으로 돌리고 겨드랑이 쪽을 내려다보세요','같은 쪽 어깨는 아래로 고정하세요',
          '30초씩 좌우'] },

  { id:'st-thoracic-ext', name:'흉추 신전', nameEn:'Thoracic Extension',
    equipment:'other', difficulty:1, hold:true,
    primary:['chest_wall'], secondary:['back'],
    description:'등 윗부분이 굽은 채 굳은 것을 폅니다. 폼롤러나 의자 등받이를 이용합니다.',
    tips:['폼롤러를 날개뼈 아래에 두고 뒤로 넘어가세요','허리가 아니라 등 윗부분이 젖혀져야 합니다',
          '손으로 머리를 받쳐 목에 힘이 안 들어가게 하세요','20~30초'] },

  { id:'st-wall-angel', name:'월 엔젤', nameEn:'Wall Angel',
    equipment:'bodyweight', difficulty:2, hold:true,
    primary:['rhomboids'], secondary:['shoulders','traps'],
    description:'벽에 붙어 팔을 위아래로 움직입니다. 늘리는 동시에 약해진 등 근육을 쓰게 만드는 운동입니다.',
    tips:['뒤통수·등·엉덩이를 벽에 붙이세요','손등과 팔꿈치가 벽에서 떨어지지 않는 범위까지만',
          '허리가 벽에서 뜨지 않게 배에 힘을 주세요','10회 천천히 · 한 세트를 초로 기록해도 됩니다'] },

  { id:'st-chin-tuck', name:'턱 당기기', nameEn:'Chin Tuck',
    equipment:'bodyweight', difficulty:1, hold:true,
    primary:['traps'], secondary:[],
    description:'앞으로 나온 머리를 제자리로 돌리는 운동입니다. 라운드숄더와 거북목은 같이 옵니다.',
    tips:['턱을 뒤로 당겨 이중턱을 만드세요','고개를 숙이는 게 아니라 수평으로 미는 느낌',
          '5초 유지 × 10회'] },

  /* ── 골반 전방경사 ──────────────────────────────────────── */
  { id:'st-kneeling-hipflexor', name:'무릎 꿇고 장요근 스트레칭', nameEn:'Kneeling Hip Flexor Stretch',
    equipment:'bodyweight', difficulty:1, hold:true,
    primary:['hip_flexor'], secondary:['quads'],
    description:'골반을 앞으로 기울게 만드는 장요근을 늘립니다. 오래 앉아 있으면 가장 먼저 짧아지는 근육입니다.',
    tips:['한쪽 무릎을 꿇고 반대 발을 앞에 두세요','꼬리뼈를 아래로 말아 넣은 뒤 앞으로 미세요',
          '허리를 젖히면 스트레칭이 안 됩니다 — 골반을 세운 채로','30초씩 좌우 2~3회'] },

  { id:'st-couch', name:'카우치 스트레칭', nameEn:'Couch Stretch',
    equipment:'other', difficulty:2, hold:true,
    primary:['quads_rf'], secondary:['hip_flexor'],
    description:'뒷발을 벽이나 소파에 올려 대퇴직근까지 깊게 늘립니다. 위 스트레칭보다 강합니다.',
    tips:['무릎이 아프면 수건을 받치세요','상체를 세울수록 강해집니다 — 버틸 수 있는 만큼만',
          '골반을 말아 넣은 자세를 끝까지 유지하세요','30초씩 좌우'] },

  { id:'st-hamstring', name:'햄스트링 스트레칭', nameEn:'Hamstring Stretch',
    equipment:'bodyweight', difficulty:1, hold:true,
    primary:['hamstrings'], secondary:['glutes'],
    description:'허벅지 뒤를 늘립니다. 골반 전방경사에서는 햄스트링이 늘어난 채 당겨져 있어 뻣뻣하게 느껴집니다.',
    tips:['무릎을 살짝 굽혀도 됩니다 — 허리를 둥글게 마는 것보다 낫습니다',
          '허리가 아니라 고관절에서 접으세요','30초씩 좌우'] },

  { id:'st-child-pose', name:'아기 자세', nameEn:"Child's Pose",
    equipment:'bodyweight', difficulty:1, hold:true,
    primary:['lower_back'], secondary:['lats'],
    description:'과하게 조인 척추기립근과 허리를 풀어줍니다.',
    tips:['무릎을 벌리고 엉덩이를 발뒤꿈치로 보내세요','팔을 멀리 뻗고 어깨를 늘어뜨리세요',
          '깊게 숨을 쉬며 30~60초'] },

  { id:'st-glute-bridge', name:'글루트 브릿지', nameEn:'Glute Bridge',
    equipment:'bodyweight', difficulty:1, hold:true,
    primary:['glutes'], secondary:['hamstrings','abs'],
    description:'약해진 둔근을 깨웁니다. 장요근을 늘리기만 하고 둔근을 쓰지 않으면 골반은 곧 되돌아갑니다.',
    tips:['갈비뼈를 아래로 내리고 배에 힘을 준 채 올리세요','허리로 젖히지 말고 엉덩이로 미세요',
          '맨 위에서 엉덩이를 조이고 버티세요','20~30초 유지 또는 15회'] },

  { id:'st-dead-bug-post', name:'데드버그 (자세 교정)', nameEn:'Dead Bug',
    equipment:'bodyweight', difficulty:1, hold:true,
    primary:['abs'], secondary:['lower_back'],
    description:'허리를 바닥에 붙인 채 팔다리를 움직여, 골반을 세우는 복근을 훈련합니다.',
    tips:['허리와 바닥 사이에 손이 들어가지 않게 붙이세요','허리가 뜨는 순간이 그날의 한계입니다',
          '천천히 · 좌우 번갈아 10회씩'] },
];

if (!DEFAULT_EXERCISES.stretch) DEFAULT_EXERCISES.stretch = [];
for (const item of STRETCH_EXERCISES) {
  if (!DEFAULT_EXERCISES.stretch.some((e) => e.id === item.id)) {
    DEFAULT_EXERCISES.stretch.push(item);
  }
}

/* 기존 목록 뒤에 이어 붙입니다 (사용자가 직접 추가한 운동은 별도 저장이라 영향 없음). */
for (const [part, list] of Object.entries(EXTRA_EXERCISES)) {
  if (!DEFAULT_EXERCISES[part]) DEFAULT_EXERCISES[part] = [];
  const seen = new Set(DEFAULT_EXERCISES[part].map((e) => e.id));
  for (const item of list) if (!seen.has(item.id)) DEFAULT_EXERCISES[part].push(item);
}

/* ============================================================
   머신 라이브러리
   ============================================================
   머신이 하체에 8개, 가슴·어깨에 2개씩, 등·팔·코어에는 0개였습니다.
   프리웨이트 위주로 짜여 있었다는 뜻인데, 헬스장에서 가장 붐비는 자리와
   초보자가 가장 먼저 앉는 자리가 정확히 그 비어 있던 쪽입니다.

   '같은 동작인데 기구만 다른 것' 은 이 라이브러리에서 원래 따로 둡니다 —
   바벨 컬 · 덤벨 컬 · 케이블 컬이 이미 그렇게 나란히 있습니다. 무게가
   걸리는 각도와 궤적이 달라 실제로 다른 운동이기 때문입니다. 다만 기구도
   같고 동작도 같은 것은 중복입니다(그래서 '케이블 시티드 로우' 를
   뺐습니다). 아래 항목은 전부 앞의 기준을 지킵니다.

   동작 그림은 아직 없습니다. media/ 에 파일이 없으면 정보 시트가 그림
   칸만 비우고 나머지(근육 지도·설명·팁)는 그대로 보여 주므로, 그림이
   준비되는 대로 exercise-photos.js 에 한 줄씩 더하면 됩니다. */
const MACHINE_EXERCISES = {
  chest: [
    { id:'incline-machine-press', name:'인클라인 체스트 프레스 머신', nameEn:'Incline Machine Press', equipment:'machine', difficulty:1,
      primary:['chest'], secondary:['shoulders','triceps'],
      description:'등받이를 세운 체스트 프레스로, 가슴 위쪽을 집중해서 씁니다. 궤적이 정해져 있어 인클라인 덤벨 프레스보다 무게를 올리기 쉽습니다.',
      tips:['손잡이가 쇄골 아래 높이에 오도록 시트를 맞추세요','팔꿈치를 완전히 펴서 잠그지 마세요'] },
    { id:'assisted-dip', name:'어시스티드 딥스', nameEn:'Assisted Dip', equipment:'machine', difficulty:1,
      primary:['chest'], secondary:['triceps','shoulders'],
      description:'무릎을 받침대에 올려 체중을 덜어 주는 딥스입니다. 맨몸 딥스가 아직 안 되는 구간을 채워 줍니다.',
      tips:['보조 무게가 클수록 쉬워집니다 — 숫자가 줄수록 발전한 것입니다','상체를 살짝 앞으로 기울이면 가슴에 더 들어갑니다'] },
  ],
  back: [
    { id:'assisted-pull-up', name:'어시스티드 풀업', nameEn:'Assisted Pull-Up', equipment:'machine', difficulty:1,
      primary:['lats','back'], secondary:['biceps'],
      description:'체중 일부를 기계가 밀어 올려 주는 턱걸이입니다. 랫풀다운과 달리 몸이 움직이므로 실제 풀업으로 넘어가는 다리가 됩니다.',
      tips:['보조 무게를 조금씩 줄여 나가는 것이 목표입니다','어깨를 먼저 내리고 팔을 당기세요'] },
    { id:'chest-supported-row', name:'체스트 서포티드 로우', nameEn:'Chest-Supported Row', equipment:'machine', difficulty:1,
      primary:['back','rhomboids'], secondary:['lats','biceps'],
      description:'가슴을 패드에 대고 당기는 로우입니다. 허리가 받는 부담이 거의 없어서, 데드리프트나 바벨 로우로 허리가 먼저 지치는 날에 등만 따로 채울 수 있습니다.',
      tips:['가슴을 패드에서 떼지 마세요 — 떼는 순간 허리 운동이 됩니다','팔꿈치를 몸통 뒤까지 보내며 견갑골을 모으세요'] },
    { id:'machine-pullover', name:'풀오버 머신', nameEn:'Machine Pullover', equipment:'machine', difficulty:2,
      primary:['lats'], secondary:['chest','triceps'],
      description:'팔을 편 채 위에서 아래로 당겨 광배근만 고립합니다. 이두가 거의 개입하지 않아, 등 운동에서 팔이 먼저 지치는 사람에게 특히 유용합니다.',
      tips:['팔꿈치 각도를 처음부터 끝까지 고정하세요','광배가 늘어나는 맨 위 지점에서 잠시 멈추세요'] },
  ],
  shoulders: [
    { id:'machine-lateral-raise', name:'레터럴 레이즈 머신', nameEn:'Machine Lateral Raise', equipment:'machine', difficulty:1,
      primary:['shoulders'], secondary:[],
      description:'팔을 옆으로 벌리는 궤적이 고정되어 있어, 덤벨로 하면 흔들리기 쉬운 마지막 몇 회를 안정적으로 채울 수 있습니다.',
      tips:['팔꿈치를 손보다 먼저 올린다는 느낌으로 미세요','내릴 때 힘을 빼지 말고 버티며 내리세요'] },
  ],
  arms: [
    { id:'machine-bicep-curl', name:'컬 머신', nameEn:'Machine Biceps Curl', equipment:'machine', difficulty:1,
      primary:['biceps'], secondary:[],
      description:'팔을 패드에 고정한 채 굽히므로 반동을 쓸 수가 없습니다. 지친 팔로도 자세가 무너지지 않아 마무리 운동으로 적합합니다.',
      tips:['겨드랑이를 패드 윗선에 붙이세요','끝까지 펴서 늘어나는 구간을 버리지 마세요'] },
    { id:'machine-preacher-curl', name:'프리처 컬 머신', nameEn:'Machine Preacher Curl', equipment:'machine', difficulty:1,
      primary:['biceps'], secondary:[],
      description:'경사 패드에 팔을 얹고 하는 컬입니다. 바벨 프리처 컬과 동작은 같지만, 머신은 아래쪽 늘어난 구간에서도 저항이 빠지지 않습니다.',
      tips:['어깨가 앞으로 말리지 않게 하세요','내릴 때 팔꿈치가 패드에서 뜨지 않게 하세요'] },
    { id:'machine-tricep-ext', name:'트라이셉 익스텐션 머신', nameEn:'Machine Triceps Extension', equipment:'machine', difficulty:1,
      primary:['triceps'], secondary:[],
      description:'앉은 자세로 팔꿈치를 고정하고 미는 삼두 고립 운동입니다. 스컬크러셔에서 팔꿈치가 아픈 사람에게 대안이 됩니다.',
      tips:['팔꿈치를 벌리지 말고 몸통 옆에 붙이세요','다 편 지점에서 1초 멈추면 자극이 확실히 커집니다'] },
  ],
  legs: [
    { id:'hip-adduction', name:'힙 어덕션', nameEn:'Hip Adduction', equipment:'machine', difficulty:1,
      primary:['adductors'], secondary:[],
      description:'다리를 안쪽으로 모으는 머신입니다. 이미 있는 힙 어브덕션(바깥으로 벌리기)과 정확히 반대 방향으로, 짝을 이루어야 골반 좌우 균형이 맞습니다.',
      tips:['상체를 뒤로 기대고 골반을 고정하세요','모은 지점에서 잠시 조였다 천천히 벌리세요'] },
    { id:'glute-machine', name:'글루트 머신', nameEn:'Glute Kickback Machine', equipment:'machine', difficulty:1,
      primary:['glutes'], secondary:['hamstrings'],
      description:'한 다리씩 뒤로 밀어 둔근만 따로 씁니다. 스쿼트나 힙 스러스트에서 허벅지 앞쪽이 먼저 타는 사람이 둔근만 채울 때 씁니다.',
      tips:['허리를 젖혀서 밀지 말고 엉덩이로만 미세요','한쪽을 끝내고 반대쪽으로 넘어가세요'] },
  ],
  core: [
    { id:'machine-crunch', name:'압도미널 크런치 머신', nameEn:'Machine Crunch', equipment:'machine', difficulty:1,
      primary:['abs'], secondary:[],
      description:'복근에 무게를 걸 수 있는 몇 안 되는 방법입니다. 맨몸 크런치가 20회씩 쉬워졌다면 여기서부터 다시 강도를 올릴 수 있습니다.',
      tips:['목이 아니라 명치를 골반 쪽으로 말아 내리세요','반동으로 내려갔다 올라오지 마세요'] },
    { id:'rotary-torso', name:'로터리 토르소', nameEn:'Rotary Torso', equipment:'machine', difficulty:2,
      primary:['abs'], secondary:['lower_back'],
      description:'상체를 좌우로 비트는 머신으로 옆구리를 씁니다. 가동 범위를 크게 잡으면 허리에 부담이 가므로 각도를 작게 두고 시작하세요.',
      tips:['가동 범위를 욕심내지 마세요 — 작게 시작합니다','골반은 고정한 채 갈비뼈만 돌린다고 생각하세요'] },
  ],
};

/* EXTRA_EXERCISES 와 같은 방식으로 이어 붙입니다. id 가 겹치면 건너뛰므로
   위쪽에 같은 운동이 이미 있어도 덮어쓰지 않습니다. */
for (const [part, list] of Object.entries(MACHINE_EXERCISES)) {
  if (!DEFAULT_EXERCISES[part]) DEFAULT_EXERCISES[part] = [];
  const seen = new Set(DEFAULT_EXERCISES[part].map((e) => e.id));
  for (const item of list) if (!seen.has(item.id)) DEFAULT_EXERCISES[part].push(item);
}


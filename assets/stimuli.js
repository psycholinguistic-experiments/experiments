/* LT5461 translation-priming stimuli (Chinese prime -> English target).

   Design follows Chaouch-Orozco, González Alonso & Rothman (2021, Applied
   Psycholinguistics) and Chaouch-Orozco et al. (2023, SSLA):
   - Two matched sets per task. List 1: set 1 related, set 2 control; List 2 the
     reverse, so across participants every target appears in both conditions.
   - Control primes are the translations of OTHER targets in the same set,
     re-paired by hand so that each is used exactly once and no control pair is
     related in meaning (e.g. BRIDGE never gets 水 "water").
   - Nonword targets get their own primes (translations of words used nowhere
     else), so no prime or target is ever seen twice.
   - Masked and visible tasks use separate items: students usually run both in
     one class, and shared items would mean repeated targets.

   Sets were matched on SUBTLEX-UK Zipf frequency and length:
     masked  A 4.99 / B 5.00   visible C 4.79 / D 4.78   length 4.80 in all four.
   Every pseudoword is absent from SUBTLEX-UK (160k entries).

   Row format: [TARGET, simplified, traditional, TARGET whose translation is the
   control prime]. */

window.LT5461_STIMULI = {
  masked: {
    sets: [
      [
        ['DOG', '狗', '狗', 'CLOCK'],
        ['SUN', '太阳', '太陽', 'TABLE'],
        ['BOOK', '书', '書', 'WATER'],
        ['DOOR', '门', '門', 'FISH'],
        ['TREE', '树', '樹', 'KNIFE'],
        ['HAND', '手', '手', 'RAIN'],
        ['FISH', '鱼', '魚', 'WINDOW'],
        ['RAIN', '雨', '雨', 'DOCTOR'],
        ['APPLE', '苹果', '蘋果', 'BRIDGE'],
        ['TABLE', '桌子', '桌子', 'SUN'],
        ['WATER', '水', '水', 'BOOK'],
        ['KNIFE', '刀', '刀', 'FLOWER'],
        ['HORSE', '马', '馬', 'KITCHEN'],
        ['BREAD', '面包', '麵包', 'DOOR'],
        ['CLOCK', '时钟', '時鐘', 'DOG'],
        ['FLOWER', '花', '花', 'HAND'],
        ['DOCTOR', '医生', '醫生', 'BREAD'],
        ['WINDOW', '窗户', '窗戶', 'APPLE'],
        ['BRIDGE', '桥', '橋', 'TREE'],
        ['KITCHEN', '厨房', '廚房', 'HORSE']
      ],
      [
        ['CAT', '猫', '貓', 'SHIRT'],
        ['EGG', '鸡蛋', '雞蛋', 'SCHOOL'],
        ['MOON', '月亮', '月亮', 'MONEY'],
        ['FIRE', '火', '火', 'TEACHER'],
        ['BIRD', '鸟', '鳥', 'PHONE'],
        ['BOAT', '船', '船', 'HEART'],
        ['MILK', '牛奶', '牛奶', 'ISLAND'],
        ['SNOW', '雪', '雪', 'CHAIR'],
        ['HOUSE', '房子', '房子', 'MOON'],
        ['CHAIR', '椅子', '椅子', 'BIRD'],
        ['RIVER', '河', '河', 'FRIEND'],
        ['PHONE', '电话', '電話', 'MILK'],
        ['HEART', '心', '心', 'BOAT'],
        ['MONEY', '钱', '錢', 'SNOW'],
        ['SHIRT', '衬衫', '襯衫', 'RIVER'],
        ['SCHOOL', '学校', '學校', 'CAT'],
        ['FRIEND', '朋友', '朋友', 'BOTTLE'],
        ['ISLAND', '岛', '島', 'EGG'],
        ['BOTTLE', '瓶子', '瓶子', 'FIRE'],
        ['TEACHER', '老师', '老師', 'HOUSE']
      ]
    ],
    nonwords: [
      'FEP', 'VUB', 'YUD', 'TAV',
      'SLOM', 'GLIN', 'DROF', 'TWEM', 'DRIM', 'NESK', 'PORB', 'CLOF', 'VESH', 'SMEF', 'PRAB', 'JOSK',
      'FLOSK', 'PLISK', 'SNARM', 'CRELP', 'SLODE', 'GLIMP', 'BRISP', 'DWELK', 'CHOMB', 'SPREM', 'GRUSK', 'BLAVE', 'TRUME', 'CLONT',
      'SORPLE', 'GRIMET', 'BASKON', 'TREMBY', 'CLOVET', 'DRINUS', 'PLAFEN', 'NOFTER',
      'FLONDER', 'MARTISH'
    ],
    nonwordPrimes: [
      ['山', '山'], ['茶', '茶'], ['药', '藥'], ['笔', '筆'], ['猪', '豬'],
      ['碗', '碗'], ['球', '球'], ['冰', '冰'], ['肉', '肉'], ['米', '米'],
      ['酒', '酒'], ['油', '油'], ['鸭', '鴨'], ['虫', '蟲'], ['伞', '傘'],
      ['叶', '葉'], ['鼓', '鼓'], ['旗', '旗'], ['塔', '塔'], ['熊', '熊'],
      ['耳朵', '耳朵'], ['衣服', '衣服'], ['帽子', '帽子'], ['电脑', '電腦'], ['电视', '電視'],
      ['汽车', '汽車'], ['沙发', '沙發'], ['袜子', '襪子'], ['盒子', '盒子'], ['城市', '城市'],
      ['公园', '公園'], ['银行', '銀行'], ['商店', '商店'], ['字典', '字典'], ['地图', '地圖'],
      ['蜡烛', '蠟燭'], ['大象', '大象'], ['蜜蜂', '蜜蜂'], ['眉毛', '眉毛'], ['裤子', '褲子']
    ]
  },

  visible: {
    sets: [
      [
        ['EYE', '眼睛', '眼睛', 'SHOE'],
        ['KEY', '钥匙', '鑰匙', 'SOLDIER'],
        ['SHOE', '鞋子', '鞋子', 'STAR'],
        ['STAR', '星星', '星星', 'NURSE'],
        ['ROAD', '路', '路', 'MONKEY'],
        ['LAMP', '灯', '燈', 'SHEEP'],
        ['KING', '国王', '國王', 'PAPER'],
        ['WIND', '风', '風', 'CAMERA'],
        ['TRAIN', '火车', '火車', 'MOTHER'],
        ['SUGAR', '糖', '糖', 'ROAD'],
        ['STONE', '石头', '石頭', 'KING'],
        ['SHEEP', '羊', '羊', 'KEY'],
        ['PLANE', '飞机', '飛機', 'STONE'],
        ['PAPER', '纸', '紙', 'TRAIN'],
        ['NURSE', '护士', '護士', 'WIND'],
        ['MOTHER', '妈妈', '媽媽', 'LAMP'],
        ['FOREST', '森林', '森林', 'EYE'],
        ['CAMERA', '相机', '相機', 'FOREST'],
        ['MONKEY', '猴子', '猴子', 'PLANE'],
        ['SOLDIER', '士兵', '士兵', 'SUGAR']
      ],
      [
        ['TOY', '玩具', '玩具', 'TIGER'],
        ['SEA', '海', '海', 'PENCIL'],
        ['CAKE', '蛋糕', '蛋糕', 'WALL'],
        ['WALL', '墙', '牆', 'GIRL'],
        ['GIRL', '女孩', '女孩', 'PIANO'],
        ['BABY', '婴儿', '嬰兒', 'CHURCH'],
        ['SALT', '盐', '鹽', 'MIRROR'],
        ['HAIR', '头发', '頭髮', 'CHICKEN'],
        ['CLOUD', '云', '雲', 'CHILD'],
        ['GRASS', '草', '草', 'CAKE'],
        ['MOUTH', '嘴', '嘴', 'CLOUD'],
        ['TIGER', '老虎', '老虎', 'SALT'],
        ['CHILD', '孩子', '孩子', 'SNAKE'],
        ['PIANO', '钢琴', '鋼琴', 'GRASS'],
        ['SNAKE', '蛇', '蛇', 'FATHER'],
        ['FATHER', '爸爸', '爸爸', 'SEA'],
        ['CHURCH', '教堂', '教堂', 'HAIR'],
        ['PENCIL', '铅笔', '鉛筆', 'MOUTH'],
        ['MIRROR', '镜子', '鏡子', 'TOY'],
        ['CHICKEN', '鸡', '雞', 'BABY']
      ]
    ],
    nonwords: [
      'LUP', 'VUP', 'GIK', 'NUV',
      'GREF', 'FRAB', 'KLEM', 'DRUF', 'GLAB', 'SMOV', 'TWIP', 'SKEV', 'BLET', 'CROB', 'BLIM', 'SNET',
      'FLENT', 'DRASK', 'PLUNT', 'GORSH', 'CLOST', 'SHROB', 'TRELP', 'SNOAT', 'PRAUL', 'CHOND', 'SPLET', 'TWIMB', 'FRASP', 'BLOTE',
      'MORDLE', 'TRIMEL', 'SORBEN', 'GLOMER', 'TRASKY', 'FENDRO', 'CRULET', 'DOMBLE',
      'PLANTOR', 'BRISTOM'
    ],
    nonwordPrimes: [
      ['兔', '兔'], ['狼', '狼'], ['虾', '蝦'], ['桶', '桶'], ['绳', '繩'],
      ['针', '針'], ['布', '布'], ['线', '線'], ['菜', '菜'], ['汤', '湯'],
      ['粥', '粥'], ['锅', '鍋'], ['井', '井'], ['墨', '墨'],
      ['枕头', '枕頭'], ['毛巾', '毛巾'], ['牙刷', '牙刷'], ['冰箱', '冰箱'], ['电梯', '電梯'],
      ['楼梯', '樓梯'], ['邮票', '郵票'], ['键盘', '鍵盤'], ['蝴蝶', '蝴蝶'], ['骆驼', '駱駝'],
      ['鸽子', '鴿子'], ['狮子', '獅子'], ['企鹅', '企鵝'], ['西瓜', '西瓜'], ['香蕉', '香蕉'],
      ['葡萄', '葡萄'], ['咖啡', '咖啡'], ['饼干', '餅乾'], ['超市', '超市'], ['餐厅', '餐廳'],
      ['筷子', '筷子'], ['盘子', '盤子'], ['围巾', '圍巾'], ['靴子', '靴子'], ['硬币', '硬幣'],
      ['饺子', '餃子']
    ]
  },

  /* Practice (with feedback). Shared by both tasks; none of these items occur in
     the main blocks. */
  practice: [
    { target: 'CUP', s: '杯子', t: '杯子', cond: 'related' },
    { target: 'BED', s: '床', t: '床', cond: 'related' },
    { target: 'LEG', s: '戒指', t: '戒指', cond: 'control' },
    { target: 'RING', s: '腿', t: '腿', cond: 'control' },
    { target: 'FOOB', s: '脸', t: '臉', cond: 'nonword' },
    { target: 'NERSE', s: '肩膀', t: '肩膀', cond: 'nonword' },
    { target: 'MIV', s: '脖子', t: '脖子', cond: 'nonword' },
    { target: 'SNOLT', s: '膝盖', t: '膝蓋', cond: 'nonword' }
  ]
};
